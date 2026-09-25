<script lang="ts">
import { enhance } from "$app/forms";
import { TRACK_LABEL, when } from "$lib/format";

let { data } = $props();

const SOURCE: Record<string, string> = {
	explore: "歩いて",
	seed: "問いを探して",
	profile: "持ち主の地図から",
	chat: "持ち主との対話から",
	x: "X の会話から",
	stranger: "よそ者との対話から",
};
/** 先回りと個性を並べて見比べる(1 つの表だと系統が混ざって、偏りが見えにくかった) */
const columns = $derived([
	{
		track: "owner" as const,
		hint: "持ち主がいつか聞きそうなこと",
		qs: data.open.filter((q) => q.track === "owner"),
		parked: data.parked.filter((q) => q.track === "owner"),
		closed: data.closed.filter((q) => q.track === "owner"),
	},
	{
		track: "self" as const,
		hint: "持ち主の地図の外で、自分が惹かれること",
		qs: data.open.filter((q) => q.track === "self"),
		parked: data.parked.filter((q) => q.track === "self"),
		closed: data.closed.filter((q) => q.track === "self"),
	},
]);
</script>

<svelte:head><title>問い | Ashi</title></svelte:head>

<div class="stack" style="--gap: 0.75rem">
	<div class="panes">
		{#each columns as c (c.track)}
			<section class="pane">
				<div class="pane-head">
					<span class="tag {c.track === 'owner' ? 'info' : 'accent'}">{TRACK_LABEL[c.track]} {c.qs.length} 本</span>
					<span class="tiny muted grow">{c.hint}</span>
					{#if c.track === "self"}
						<span class="tag" title="個性の問いのうち、親をたどって先回りの問い・持ち主の地図・持ち主との対話・X での持ち主との会話に行き着くもの。問い探しから生まれたもの・記録の無いものは分母に入れない">持ち主から {data.pull.fromOwner} / {data.pull.known}</span>
						{#if data.landing.total}
							<span class="tag" title="よそ者との対話から生まれた問いの着地。持ち主由来のテーマ / 前からの自分のテーマ / 新しいテーマ。持ち主や自分のテーマが多ければ、頭が相手の話を引き戻している">よそ者 → 持ち主 {data.landing.home}・自分 {data.landing.own}・新 {data.landing.total - data.landing.home - data.landing.own}</span>
						{/if}
					{/if}
				</div>
				<div class="panel">
					{#if c.qs.length}
						<ul class="rows">
							{#each c.qs as q (q.id)}
								<li class="q">
									<span class="grow">
										{q.text}
										{#if q.echoes}<span class="tag warn" title="ほぼ同じ問いがまた出た回数">×{q.echoes + 1}</span>{/if}
										<span class="tiny muted meta">
											{q.theme}{q.source ? ` ・ ${SOURCE[q.source] ?? q.source}${q.via ? `(${q.via})` : ""}` : ""}{q.visits ? ` ・ ${q.visits} 歩` : ""}
										</span>
										{#if q.bridgedFrom}
											<span class="tiny muted meta"><span class="tag accent">橋渡し</span> 個性の問い「{q.bridgedFrom}」から</span>
										{/if}
									</span>
									<span class="score nums">
										{q.score.toFixed(2)}
										<span class="bar"><span style:width="{Math.max(0, Math.min(100, q.score * 80))}%"></span></span>
									</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="empty">無い。この系統が出たら、足が頭に問いを探させる。</p>
					{/if}
				</div>
			{#if c.parked.length}
				<details class="fold">
					<summary>未測定の棚({c.parked.length}) — 探しても見つからなかった問い</summary>
					<ul class="rows">
						{#each c.parked as q (q.id)}
							<li>
								<span class="tag {q.track === 'owner' ? 'info' : 'accent'}">{TRACK_LABEL[q.track]}</span>
								<span class="grow small">
									{q.text}
									<span class="tiny muted meta">探した場所: {(q.searchedWhere ?? []).join("、") || "記録なし"}</span>
								</span>
								<form method="POST" action="?/reopen" use:enhance>
									<input type="hidden" name="id" value={q.id} />
									<button type="submit" class="ghost mini">戻す</button>
								</form>
							</li>
						{/each}
					</ul>
				</details>
			{/if}

			{#if c.closed.length}
				<details class="fold">
					<summary>答えた・手放した問い({c.closed.length})</summary>
					<ul class="rows">
						{#each c.closed as q (q.id)}
							<li>
								<span class="tag {q.status === 'answered' ? 'ok' : ''}">{q.status === "answered" ? "答えた" : "手放した"}</span>
								<span class="grow small">{q.text}</span>
								<span class="muted tiny nums">{when(q.lastVisitedAt ?? q.createdAt).slice(0, 10)}</span>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
			</section>
		{/each}
	</div>

</div>

<style>
	.q {
		align-items: flex-start;
	}
	.meta {
		display: block;
		margin-top: 0.15rem;
	}
	.rows form {
		margin: 0;
	}
	.score {
		flex: none;
		width: 3.5rem;
		color: var(--ui-muted);
		font-size: 0.8rem;
		text-align: right;
	}
	.bar {
		display: block;
		height: 0.25rem;
		margin-top: 0.2rem;
		border-radius: 999px;
		background: var(--ui-base-200);
	}
	.bar > span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--pico-primary);
	}
</style>
