<script lang="ts">
import { tick, untrack } from "svelte";
import { when } from "$lib/format";

let { data } = $props();

interface Msg {
	role: "user" | "assistant";
	text: string;
	html?: string;
	added?: string[];
}
// 前回までの対話も文脈として頭に渡す。開いたときの分だけでよい(以後は画面の中で積む)
let msgs = $state<Msg[]>(
	untrack(() =>
		data.past.flatMap((c): Msg[] => [
			{ role: "user", text: c.question },
			{ role: "assistant", text: c.reply, html: c.html },
		]),
	),
);
let input = $state("");
let busy = $state(false);
let problem = $state("");
let bottom = $state<HTMLElement | null>(null);

async function send(e: SubmitEvent) {
	e.preventDefault();
	const message = input.trim();
	if (!message || busy) return;
	const history = msgs.map(({ role, text }) => ({ role, text }));
	msgs.push({ role: "user", text: message });
	input = "";
	busy = true;
	problem = "";
	await tick();
	bottom?.scrollIntoView({ behavior: "smooth" });
	try {
		const res = await fetch("/api/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ history, message }),
		});
		if (!res.ok) {
			const err = (await res.json().catch(() => null)) as {
				message?: string;
			} | null;
			throw new Error(err?.message ?? `${res.status}`);
		}
		const r = (await res.json()) as {
			reply: string;
			html: string;
			added: string[];
		};
		msgs.push({
			role: "assistant",
			text: r.reply,
			html: r.html,
			added: r.added,
		});
	} catch (err) {
		problem = err instanceof Error ? err.message : String(err);
		// 送れなかった発言は入力欄に戻す
		msgs.pop();
		input = message;
	} finally {
		busy = false;
		await tick();
		bottom?.scrollIntoView({ behavior: "smooth" });
	}
}

function onKey(e: KeyboardEvent) {
	if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
		(e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
}
</script>

<svelte:head><title>話す | Ashi</title></svelte:head>

<main class="page stack">
	<hgroup>
		<h1>話す</h1>
		<p class="small muted">
			何を学んだか、どこを歩いているかを聞けます。「これを調べておいて」と頼むと問いに加わり、足が後で歩きます。
			ここでの発言は、持ち主の興味の地図の材料にもなります。
			{#if data.past.length}<br />前回({when(data.past.at(-1)?.at)})からの続きです。{/if}
		</p>
	</hgroup>

	<div class="stack tight">
		{#each msgs as m, i (i)}
			{#if m.role === "user"}
				<div class="me">{m.text}</div>
			{:else}
				<div class="panel pad prose ashi">
					{@html m.html ?? m.text}
					{#if m.added?.length}
						<p class="note info small">問いに加えた: {m.added.join(" / ")}</p>
					{/if}
				</div>
			{/if}
		{/each}
		{#if busy}
			<div class="cluster small muted"><span class="spin"></span>考えている(ノートを引いていると数十秒かかる)</div>
		{/if}
		<div bind:this={bottom}></div>
	</div>

	{#if problem}<p class="note err small">{problem}</p>{/if}

	<form class="stack tight" onsubmit={send}>
		<textarea bind:value={input} rows="3" placeholder="最近何を覚えた?" onkeydown={onKey} disabled={busy}></textarea>
		<div class="cluster">
			<button type="submit" disabled={busy || !input.trim()}>送る</button>
			<span class="tiny muted">Ctrl + Enter でも送れる</span>
		</div>
	</form>
</main>

<style>
	.me {
		align-self: flex-end;
		max-width: 85%;
		border-radius: var(--pico-border-radius);
		background: var(--pico-primary-background);
		padding: 0.5rem 0.8rem;
		color: var(--pico-primary-inverse);
		white-space: pre-wrap;
	}
	.ashi {
		max-width: 92%;
	}
</style>
