<script lang="ts">
import { TRACK_LABEL, when } from "$lib/format";

let { data } = $props();
</script>

<svelte:head><title>{data.note.title} | Ashi</title></svelte:head>

<main class="page stack">
	<a href="/notes" class="small">← ノート</a>
	<div class="cluster small">
		{#if data.question}
			<span class="tag {data.question.track === 'owner' ? 'info' : ''}">{TRACK_LABEL[data.question.track]}</span>
		{/if}
		<span class="muted">{data.note.theme}</span>
		<span class="muted nums">{when(data.note.createdAt)}</span>
	</div>
	<article class="prose">{@html data.html}</article>
</main>
