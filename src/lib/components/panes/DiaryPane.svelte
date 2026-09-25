<script lang="ts">
import type { diaryView } from "$lib/server/views";

/** 日記。日付は ?day= で選ぶ(いまの画面のまま切り替える) */
let { data }: { data: ReturnType<typeof diaryView> } = $props();
const label = (d: string) => d.slice(5).replace("-", "/");
</script>

<div class="pane-head">
	<hgroup>
		<h2>日記</h2>
		<p>内省の順番が来たとき、疲れたときに書く。</p>
	</hgroup>
</div>

{#if data.day}
	<nav class="days" aria-label="日付">
		{#each data.days.slice(0, 14) as d (d)}
			<a href="?day={d}" data-sveltekit-noscroll data-sveltekit-keepfocus aria-current={d === data.day ? "page" : undefined} class="nums">{label(d)}</a>
		{/each}
	</nav>
	<article class="panel doc prose">{@html data.html}</article>
{:else}
	<div class="panel"><p class="empty">まだ日記が無い。</p></div>
{/if}

<style>
	.days {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.days a {
		border-radius: 999px;
		padding: 0.2rem 0.7rem;
		background: var(--ui-surface);
		color: inherit;
		font-size: 0.85rem;
		text-decoration: none;
	}
	.days a[aria-current="page"] {
		background: var(--pico-primary-background);
		color: var(--pico-primary-inverse);
		font-weight: 700;
	}
	.doc {
		padding: 1.25rem 1.5rem;
	}
</style>
