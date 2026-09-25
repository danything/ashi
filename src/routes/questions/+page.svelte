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
</script>

<svelte:head><title>問い | Ashi</title></svelte:head>

<div class="stack" style="--gap: 1.25rem">
	<div class="head">
		<hgroup>
			<h1>問い</h1>
			<p>
				点数は頭の見立て(惹かれる・価値・進めやすさ)に、まだ歩いていない分を足し、何度も歩いた分を引いたもの。
				どちらの系統を歩くかは足がさいころで決め、ときどき寄り道する。個性の問いで得た見方が持ち主の関心に効くと、先回りの問いにして持ち帰る(橋渡し)。
			</p>
		</hgroup>
	</div>

	<section class="panel">
		<div class="panel-head">
			<h2>開いている問い({data.open.length})</h2>
			<span class="tag" title="個性の問いのうち、親をたどって先回りの問い・持ち主の地図・持ち主との対話・X での持ち主との会話に行き着くもの。問い探しから生まれたもの・記録の無いものは分母に入れない">
				個性のうち持ち主から {data.pull.fromOwner} / {data.pull.known}
			</span>
		</div>
		{#if data.open.length}
			<div class="scroll-x">
				<table>
					<thead>
						<tr><th>系統</th><th>問い</th><th>テーマ</th><th class="r">点</th><th class="r">歩数</th></tr>
					</thead>
					<tbody>
						{#each data.open as q (q.id)}
							<tr>
								<td><span class="tag {q.track === 'owner' ? 'info' : 'accent'}">{TRACK_LABEL[q.track]}</span></td>
								<td>
									{q.text}
									{#if q.echoes}<span class="tag warn" title="ほぼ同じ問いがまた出た回数">×{q.echoes + 1}</span>{/if}
									{#if q.source}<span class="tiny muted"> ・ {SOURCE[q.source] ?? q.source}{q.via ? `(@${q.via})` : ""}</span>{/if}
									{#if q.bridgedFrom}
										<div class="tiny muted bridge">
											<span class="tag accent">橋渡し</span> 個性の問い「{q.bridgedFrom}」から
										</div>
									{/if}
								</td>
								<td class="muted small">{q.theme}</td>
								<td class="r nums">
									{q.score.toFixed(2)}
									<div class="bar"><span style:width="{Math.max(0, Math.min(100, q.score * 80))}%"></span></div>
								</td>
								<td class="r nums">{q.visits}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="empty">開いている問いは無い。次の 1 歩で頭が問いを探す。</p>
		{/if}
	</section>

	{#if data.parked.length}
		<section class="panel">
			<div class="panel-head">
				<h2>未測定の棚({data.parked.length})</h2>
				<span class="tag">探しても見つからなかった</span>
			</div>
			<ul class="rows">
				{#each data.parked as q (q.id)}
					<li>
						<span class="tag {q.track === 'owner' ? 'info' : 'accent'}">{TRACK_LABEL[q.track]}</span>
						<span class="grow small">
							{q.text}
							<span class="tiny muted parked-where">探した場所: {(q.searchedWhere ?? []).join("、") || "記録なし"}</span>
						</span>
						<form method="POST" action="?/reopen" use:enhance>
							<input type="hidden" name="id" value={q.id} />
							<button type="submit" class="ghost mini">戻す</button>
						</form>
					</li>
				{/each}
			</ul>
		</section>
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
	.parked-where {
		display: block;
	}
	.rows form {
		margin: 0;
	}
	.bridge {
		margin-top: 0.25rem;
	}
	.r {
		text-align: right;
	}
	.bar {
		width: 3.5rem;
		height: 0.25rem;
		margin: 0.2rem 0 0 auto;
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
