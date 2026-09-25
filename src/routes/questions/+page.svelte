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
	},
	{
		track: "self" as const,
		hint: "持ち主の地図の外で、自分が惹かれること",
		qs: data.open.filter((q) => q.track === "self"),
	},
]);
</script>

<svelte:head><title>問い | Ashi</title></svelte:head>

<div class="stack" style="--gap: 1rem">
	<div class="head">
		<hgroup>
			<h1>問い({data.open.length})</h1>
			<p>点数は頭の見立てに、まだ歩いていない分を足し、何度も歩いた分を引いたもの。どちらの系統を歩くかは足がさいころで決める。</p>
		</hgroup>
		<span class="tag" title="個性の問いのうち、親をたどって先回りの問い・持ち主の地図・持ち主との対話・X での持ち主との会話に行き着くもの。問い探しから生まれたもの・記録の無いものは分母に入れない">
			個性のうち持ち主から {data.pull.fromOwner} / {data.pull.known}
		</span>
		{#if data.landing.total}
			<span class="tag" title="よそ者との対話から生まれた問いのうち、持ち主由来のテーマに着地したもの。高ければ、頭が相手の話を持ち主の関心へ引き戻している">
				よそ者から持ち主のテーマへ {data.landing.home} / {data.landing.total}
			</span>
		{/if}
	</div>

	<div class="panes">
		{#each columns as c (c.track)}
			<section class="pane">
				<div class="pane-head">
					<hgroup>
						<h2><span class="tag {c.track === 'owner' ? 'info' : 'accent'}">{TRACK_LABEL[c.track]}</span> {c.qs.length} 本</h2>
						<p>{c.hint}</p>
					</hgroup>
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
			</section>
		{/each}
	</div>

	{#if data.parked.length}
		<details class="fold">
			<summary>未測定の棚({data.parked.length}) — 探しても見つからなかった問い</summary>
			<ul class="rows">
				{#each data.parked as q (q.id)}
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

	{#if data.closed.length}
		<details class="fold">
			<summary>答えた・手放した問い({data.closed.length})</summary>
			<ul class="rows">
				{#each data.closed as q (q.id)}
					<li>
						<span class="tag {q.status === 'answered' ? 'ok' : ''}">{q.status === "answered" ? "答えた" : "手放した"}</span>
						<span class="grow small">{q.text}</span>
						<span class="muted tiny nums">{when(q.lastVisitedAt ?? q.createdAt).slice(0, 10)}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
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
