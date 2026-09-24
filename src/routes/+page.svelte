<script lang="ts">
import { enhance } from "$app/forms";
import { TRACK_LABEL, usd, when } from "$lib/format";

let { data } = $props();

const sleeping = $derived(
	data.walk.sleepingUntil && new Date(data.walk.sleepingUntil) > new Date()
		? data.walk.sleepingUntil
		: null,
);
const EVENTS: Record<string, string> = {
	walked: "歩いた",
	seeded: "問いを探した",
	reflected: "内省した",
	profiled: "持ち主の地図を書き直した",
	chat: "話した",
	broke: "予算切れ",
	failed: "つまずいた",
	crashed: "落ちた",
	"core-changed": "コア原則が変わった",
};
</script>

<svelte:head><title>いま | Ashi</title></svelte:head>

<main class="page stack">
	<section class="panel body">
		<div class="cluster">
			<h1 class="grow">いま</h1>
			{#if !data.walking}
				<span class="tag warn">歩いていない(ASHI_WALK=0 か止まった)</span>
			{:else if sleeping}
				<span class="tag">休んでいる</span>
			{:else}
				<span class="tag ok">歩いている</span>
			{/if}
		</div>
		<dl class="kv small">
			<dt>歩数</dt>
			<dd class="nums">{data.walk.steps}</dd>
			<dt>次に起きる</dt>
			<dd>{sleeping ? when(sleeping) : "いま"}</dd>
			<dt>今日の予算</dt>
			<dd class="nums">{usd(data.budget.spentUsd)} / {usd(data.dailyUsd)}</dd>
			<dt>頭</dt>
			<dd>{data.model}</dd>
			<dt>問い</dt>
			<dd class="nums">
				開いている {data.counts.open}(先回り {data.counts.owner}・個性 {data.counts.self})、答えた {data.counts.answered}、ノート {data.counts.notes}
			</dd>
			<dt>系統の割合</dt>
			<dd class="nums">先回り {Math.round(data.ownerShare * 100)}% / 個性 {Math.round((1 - data.ownerShare) * 100)}%</dd>
		</dl>
		{#if sleeping}
			<form method="POST" action="?/wake" use:enhance>
				<button type="submit" class="outline">起こす</button>
			</form>
		{/if}
	</section>

	<section class="stack tight">
		<h2>次に歩きそうな問い</h2>
		{#each data.next as q (q.id)}
			<div class="cluster small">
				<span class="tag {q.track === 'owner' ? 'info' : ''}">{TRACK_LABEL[q.track]}</span>
				<span class="muted">{q.theme}</span>
				<span class="grow">{q.text}</span>
				<span class="nums muted tiny">{q.score.toFixed(2)}</span>
			</div>
		{:else}
			<p class="muted">まだ無い。次の 1 歩で頭が問いを探す。</p>
		{/each}
	</section>

	<section class="stack tight">
		<h2>最近のノート</h2>
		{#each data.notes as n (n.id)}
			<a href="/notes/{n.id}" class="small">{n.title}</a>
		{:else}
			<p class="muted">まだ無い。</p>
		{/each}
	</section>

	<section class="stack tight">
		<h2>足どり</h2>
		<ul class="small log">
			{#each data.log as e, i (i)}
				<li>
					<span class="muted nums">{when(e.at)}</span>
					{EVENTS[e.event] ?? e.event}
					{#if typeof e.question === "string"}: {e.question}{/if}
					{#if typeof e.error === "string"}<span class="muted">: {e.error}</span>{/if}
					{#if typeof e.usd === "number"}<span class="muted tiny nums">({usd(e.usd)})</span>{/if}
				</li>
			{:else}
				<li class="muted">まだ歩いていない。</li>
			{/each}
		</ul>
	</section>
</main>

<style>
	.kv {
		display: grid;
		grid-template-columns: 8rem 1fr;
		gap: 0.25rem 1rem;
	}
	.kv dd {
		margin: 0;
	}
	.log {
		padding-left: 1.1rem;
	}
</style>
