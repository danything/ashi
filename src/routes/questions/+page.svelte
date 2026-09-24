<script lang="ts">
import { TRACK_LABEL, when } from "$lib/format";

let { data } = $props();
</script>

<svelte:head><title>問い | Ashi</title></svelte:head>

<div class="stack" style="--gap: 1.25rem">
	<div class="head">
		<hgroup>
			<h1>問い</h1>
			<p>
				点数は頭の見立て(惹かれる・価値・進めやすさ)に、まだ歩いていない分を足し、何度も歩いた分を引いたもの。
				どちらの系統を歩くかは足がさいころで決め、ときどき寄り道する。
			</p>
		</hgroup>
	</div>

	<section class="panel">
		<div class="panel-head"><h2>開いている問い({data.open.length})</h2></div>
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
								<td>{q.text}</td>
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
