<script lang="ts">
import { TRACK_LABEL, when } from "$lib/format";

let { data } = $props();
</script>

<svelte:head><title>ノート | Ashi</title></svelte:head>

<main class="page stack">
	<div class="cluster">
		<h1 class="grow">ノート</h1>
		<form method="GET" class="cluster">
			<input name="q" value={data.q} placeholder="題・要約・テーマで探す" aria-label="探す" />
			<button type="submit" class="outline">探す</button>
		</form>
	</div>
	{#each data.notes as n (n.id)}
		<article class="panel body">
			<div class="cluster small">
				<span class="tag {n.track === 'owner' ? 'info' : ''}">{TRACK_LABEL[n.track]}</span>
				<span class="muted">{n.theme}</span>
				<span class="grow"></span>
				<span class="muted nums tiny">{when(n.createdAt)}</span>
			</div>
			<a href="/notes/{n.id}"><strong>{n.title}</strong></a>
			<p class="small">{n.summary}</p>
		</article>
	{:else}
		<p class="muted">{data.q ? "見つからない。" : "まだノートが無い。"}</p>
	{/each}
</main>
