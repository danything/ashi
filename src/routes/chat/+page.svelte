<script lang="ts">
import { tick, untrack } from "svelte";
import { afterNavigate } from "$app/navigation";
import Icon from "$lib/components/Icon.svelte";
import Logo from "$lib/components/Logo.svelte";
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

/**
 * ページの一番下まで送る。入力欄は下に貼り付いているので、最後の発言の位置に合わせると入力欄に
 * 隠れる。ページの端まで送れば、入力欄は流れの中の元の位置(発言の下)に戻り、何も隠れない
 */
function toEnd(behavior: ScrollBehavior = "smooth") {
	window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
}

// 開いたときは最新(いちばん下)から見せる。onMount だと、ほかの画面から移ってきたときに
// SvelteKit が移動の後でスクロールを上に戻してしまうので、移動が済んだ後に送る(リロードでも呼ばれる)
afterNavigate(() => toEnd("instant"));

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
	toEnd();
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
		toEnd();
	}
}

function onKey(e: KeyboardEvent) {
	if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
		(e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
}
</script>

<svelte:head><title>話す | Ashi</title></svelte:head>

<div class="chat">

	<div class="log">
		{#if data.past.length}
			<p class="divider tiny muted"><span>前回({when(data.past.at(-1)?.at)})からの続き</span></p>
		{:else if msgs.length === 0}
			<div class="panel soft hello small">
				<p>たとえば:</p>
				<ul>
					<li>最近何を覚えた?</li>
					<li>先回りして調べてあることはある?</li>
					<li>Talos のバックアップの取り方を調べておいて</li>
				</ul>
			</div>
		{/if}
		{#each msgs as m, i (i)}
			{#if m.role === "user"}
				<div class="me">{m.text}</div>
			{:else}
				<div class="ashi">
					<span class="avatar"><Logo /></span>
					<div class="panel bubble">
						<div class="prose">{@html m.html ?? m.text}</div>
						{#if m.added?.length}
							<p class="note info tiny">問いに加えた: {m.added.join(" / ")}</p>
						{/if}
					</div>
				</div>
			{/if}
		{/each}
		{#if busy}
			<div class="ashi">
				<span class="avatar"><Logo /></span>
				<div class="panel bubble cluster small muted"><span class="spin"></span>考えている(ノートを引いていると数十秒かかる)</div>
			</div>
		{/if}
	</div>

	<form class="composer panel" onsubmit={send}>
		{#if problem}<p class="note err small">{problem}</p>{/if}
		<!-- 1 行にして、発言を読む幅を広く取る。長く書くと 6 行まで伸びる -->
		<div class="line">
			<textarea bind:value={input} rows="1" placeholder="最近何を覚えた?(Ctrl + Enter で送る)" onkeydown={onKey} disabled={busy} aria-label="話しかける"></textarea>
			<button type="submit" class="small" disabled={busy || !input.trim()}><Icon name="send" size={1} />送る</button>
		</div>
	</form>
</div>

<style>
	.chat {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.log {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.divider::before,
	.divider::after {
		content: "";
		flex: 1;
		border-top: 1px solid var(--ui-base-300);
	}
	.hello ul {
		margin: 0.25rem 0 0;
		padding-left: 1.2rem;
	}
	.me {
		align-self: flex-end;
		max-width: 80%;
		border-radius: 1rem 1rem 0.25rem 1rem;
		background: var(--pico-primary-background);
		padding: 0.6rem 0.9rem;
		color: var(--pico-primary-inverse);
		white-space: pre-wrap;
	}
	.ashi {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		max-width: 92%;
	}
	.avatar {
		display: inline-flex;
		margin-top: 0.2rem;
		color: var(--pico-primary);
	}
	.bubble {
		min-width: 0;
		border-top-left-radius: 0.25rem;
		padding: 0.75rem 1rem;
	}
	/* 入力欄は画面の下に貼り付ける */
	.composer {
		position: sticky;
		/* ページ下の余白と同じ位置に貼り付ける(違うと、いちばん下まで来たときに入力欄がずれる) */
		bottom: var(--main-pad-bottom);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.5rem;
	}
	.line {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
	}
	.line textarea {
		flex: 1;
		margin: 0;
		resize: none;
		/* 書いた分だけ伸びる(対応していないブラウザでは 1 行のまま中でスクロール) */
		field-sizing: content;
		min-height: 2.6rem;
		max-height: 10rem;
	}
	.line button {
		flex: none;
		margin: 0;
		min-height: 2.6rem;
	}
</style>
