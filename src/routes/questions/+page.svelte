<script lang="ts">
import { TRACK_LABEL, when } from "$lib/format";

let { data } = $props();
</script>

<svelte:head><title>問い | Ashi</title></svelte:head>

<main class="page stack">
	<hgroup>
		<h1>問い</h1>
		<p class="small muted">
			点数は頭の見立て(惹かれる・価値・進めやすさ)に、足が「まだ歩いていない」を足し「何度も歩いた」を引いたもの。
			どちらの系統を歩くかは足がさいころで決め、ときどき寄り道する。
		</p>
	</hgroup>
	<div class="scroll-x">
		<table>
			<thead>
				<tr><th>系統</th><th>テーマ</th><th>問い</th><th>点</th><th>歩数</th></tr>
			</thead>
			<tbody>
				{#each data.open as q (q.id)}
					<tr>
						<td><span class="tag {q.track === 'owner' ? 'info' : ''}">{TRACK_LABEL[q.track]}</span></td>
						<td class="muted">{q.theme}</td>
						<td>{q.text}</td>
						<td class="nums">{q.score.toFixed(2)}</td>
						<td class="nums">{q.visits}</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="muted">開いている問いは無い。</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	<details class="fold">
		<summary>答えた・手放した問い({data.closed.length})</summary>
		<ul class="inner small">
			{#each data.closed as q (q.id)}
				<li>
					<span class="tag {q.status === 'answered' ? 'ok' : ''}">{q.status === "answered" ? "答えた" : "手放した"}</span>
					{q.text} <span class="muted tiny">{when(q.lastVisitedAt ?? q.createdAt)}</span>
				</li>
			{/each}
		</ul>
	</details>
</main>
