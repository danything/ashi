<script lang="ts">
import { enhance } from "$app/forms";
import Icon from "$lib/components/Icon.svelte";
import { TRACK_LABEL, usd, when } from "$lib/format";

let { data } = $props();

const sleeping = $derived(
	data.walk.sleepingUntil && new Date(data.walk.sleepingUntil) > new Date()
		? data.walk.sleepingUntil
		: null,
);
const subscription = $derived(data.cfg.head === "claude-code");
const stepsToday = $derived(data.budget.steps ?? 0);
const pct = (a: number, b: number) =>
	`${Math.min(100, Math.round((a / Math.max(b, 1e-9)) * 100))}%`;

const EVENTS: Record<string, string> = {
	walked: "歩いた",
	seeded: "問いを探した",
	reflected: "内省した",
	profiled: "持ち主の地図を書き直した",
	crawled: "足跡を読んだ",
	chat: "話した",
	broke: "上限で休んだ",
	blocked: "弾かれた",
	failed: "つまずいた",
	crashed: "落ちた",
	"core-changed": "コア原則が変わった",
	stranger: "よそ者と話した",
	"stranger-failed": "よそ者と話せなかった",
	"self-changed": "自己記述を変えた",
	mentions: "X で話しかけられた",
	conversed: "X で返した",
	reset: "学びをリセットした",
};
</script>

<svelte:head><title>いま | Ashi</title></svelte:head>

<div class="stack" style="--gap: 0.75rem">
	<div class="stats">
		<div class="panel stat">
			<span class="label"><Icon name="footprints" size={0.9} />今日の歩数</span>
			<span class="value">{stepsToday}<span class="unit"> / {data.cfg.maxStepsPerDay}</span></span>
			<div class="meter"><span style:width={pct(stepsToday, data.cfg.maxStepsPerDay)}></span></div>
			<span class="sub">通算 {data.walk.steps} 歩</span>
		</div>
		<div class="panel stat">
			<span class="label">
				<Icon name="moon" size={0.9} />次に起きる
				{#if !data.walking}
					<span class="tag warn">歩いていない</span>
				{:else if sleeping}
					<span class="tag"><span class="dot"></span>休んでいる</span>
				{:else}
					<span class="tag ok"><span class="dot live"></span>歩いている</span>
				{/if}
			</span>
			<span class="value">{sleeping ? when(sleeping).slice(11) : "いま"}</span>
			<span class="sub wake">
				{sleeping ? when(sleeping).slice(0, 10) : "起きている"}
				{#if sleeping}
					<form method="POST" action="?/wake" use:enhance>
						<button type="submit" class="outline mini"><Icon name="footprints" size={0.9} />起こす</button>
					</form>
				{/if}
			</span>
		</div>
		<div class="panel stat">
			<span class="label"><Icon name="wallet" size={0.9} />{subscription ? "頭" : "今日の予算"}</span>
			{#if subscription}
				<span class="value small-value">サブスク</span>
				<span class="sub">{data.cfg.model}(Claude Code)</span>
			{:else}
				<span class="value">{usd(data.budget.spentUsd)}<span class="unit"> / {usd(data.cfg.dailyUsd)}</span></span>
				<div class="meter"><span style:width={pct(data.budget.spentUsd, data.cfg.dailyUsd)}></span></div>
				<span class="sub">{data.cfg.model}</span>
			{/if}
		</div>
		<div class="panel stat">
			<span class="label"><Icon name="help" size={0.9} />開いている問い</span>
			<span class="value">{data.counts.open}</span>
			<span class="sub">先回り {data.counts.owner} ・ 個性 {data.counts.self} ・ 答えた {data.counts.answered}</span>
		</div>
		<div class="panel stat">
			<span class="label"><Icon name="book" size={0.9} />ノート</span>
			<span class="value">{data.counts.notes}</span>
			<span class="sub">先回り {Math.round(data.cfg.ownerShare * 100)}% で歩く</span>
		</div>
	</div>

	<!-- 3 つを並べ、枠ごとにスクロールする(足どりが下に長く伸びていた) -->
	<div class="panes" style="--cols: 3">
		<section class="pane">
			<div class="pane-head">
				<span class="pane-name">次に歩きそうな問い</span>
				<span class="hint"></span>
				<a class="small" href="/questions">すべて</a>
			</div>
			<div class="panel">
			{#if data.next.length}
				<ul class="rows">
					{#each data.next as q (q.id)}
						<li>
							<span class="tag {q.track === 'owner' ? 'info' : 'accent'}">{TRACK_LABEL[q.track]}</span>
							<span class="grow">{q.text}<span class="muted tiny"> ・ {q.theme}</span></span>
							<span class="nums muted tiny">{q.score.toFixed(2)}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">まだ無い。次の 1 歩で頭が問いを探す。</p>
			{/if}
			</div>
		</section>

		<section class="pane">
			<div class="pane-head">
				<span class="pane-name">最近のノート</span>
				<span class="hint"></span>
				<a class="small" href="/notes">すべて</a>
			</div>
			<div class="panel">
			{#if data.notes.length}
				<ul class="rows">
					{#each data.notes as n (n.id)}
						<li>
							<span class="grow">
								<a href="/notes/{n.id}">{n.title}</a>
								<span class="muted tiny clamp2">{n.summary}</span>
							</span>
							<span class="muted tiny nums">{when(n.createdAt).slice(5, 10)}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">まだ無い。</p>
			{/if}
			</div>
		</section>

	<section class="pane">
		<div class="pane-head"><span class="pane-name">足どり</span></div>
		<div class="panel">
		{#if data.log.length}
			<ol class="timeline">
				{#each data.log as e, i (i)}
					<li class:bad={e.event === "failed" || e.event === "blocked" || e.event === "crashed"}>
						<span class="when muted nums tiny">{when(e.at).slice(5)}</span>
						<span class="what">
							<strong>{EVENTS[e.event] ?? e.event}</strong>
							{#if e.event === "seeded" && (e.track === "owner" || e.track === "self")}<span> {TRACK_LABEL[e.track]}</span>{/if}
							{#if typeof e.question === "string"}<span> {e.question}</span>{/if}
							{#if typeof e.title === "string"}<span> {e.title}</span>{/if}
							{#if typeof e.field === "string"}<span class="tag accent">{e.field}</span>{/if}
							{#if Array.isArray(e.proposed) && e.proposed.length}<a class="tag" href="/proposals">改善案</a><span class="muted"> {e.proposed.join(" / ")}</span>{/if}
							{#if Array.isArray(e.bridged) && e.bridged.length}<span class="tag accent">橋渡し</span><span class="muted"> {e.bridged.join(" / ")}</span>{/if}
							{#if typeof e.error === "string"}<span class="muted"> {e.error}</span>{/if}
						</span>
						{#if typeof e.usd === "number" && e.usd > 0}<span class="muted tiny nums">{usd(e.usd)}</span>{/if}
					</li>
				{/each}
			</ol>
		{:else}
			<p class="empty">まだ歩いていない。</p>
		{/if}
		</div>
		</section>
	</div>
</div>

<style>
	.wake {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.wake form {
		margin: 0;
	}
	.unit {
		color: var(--ui-muted);
		font-size: 0.85rem;
		font-weight: 600;
	}
	.small-value {
		font-size: 1.1rem;
	}
	.timeline {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.timeline li {
		position: relative;
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.35rem 0 0.35rem 1rem;
		font-size: 0.9rem;
		list-style: none;
	}
	.timeline li::before {
		content: "";
		position: absolute;
		top: 0.85rem;
		left: 0;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 999px;
		background: var(--ui-accent);
	}
	.timeline li.bad::before {
		background: var(--ui-err);
	}
	.timeline .when {
		flex: none;
		width: 6.5rem;
	}
	.timeline .what {
		flex: 1 1 auto;
		min-width: 0;
	}
</style>
