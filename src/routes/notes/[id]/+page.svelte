<script lang="ts">
import Icon from "$lib/components/Icon.svelte";
import { TRACK_LABEL, when } from "$lib/format";

let { data } = $props();
</script>

<svelte:head><title>{data.note.title} | Ashi</title></svelte:head>

<div class="stack" style="--gap: 1rem">
	<a href="/notes" class="small back"><Icon name="arrow-left" size={0.9} />ノート</a>
	<article class="panel doc">
		<div class="cluster meta">
			{#if data.question}
				<span class="tag {data.question.track === 'owner' ? 'info' : 'accent'}">{TRACK_LABEL[data.question.track]}</span>
			{/if}
			<span class="muted small">{data.note.theme}</span>
			<span class="grow"></span>
			<span class="muted small nums">{when(data.note.createdAt)}</span>
		</div>
		<div class="prose">{@html data.html}</div>
	</article>
</div>

<style>
	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		align-self: flex-start;
		text-decoration: none;
	}
	.doc {
		padding: 1.5rem 1.75rem;
	}
	.meta {
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--ui-base-200);
	}
</style>
