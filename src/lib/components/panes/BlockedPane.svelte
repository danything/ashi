<script lang="ts">
import { enhance } from "$app/forms";
import Icon from "$lib/components/Icon.svelte";
import { when } from "$lib/format";
import type { blockedView } from "$lib/server/views";

/** 弾かれたこと。フォームは /blocked の actions に送る */
let { data }: { data: ReturnType<typeof blockedView> } = $props();

const SOURCE: Record<string, string> = {
	head: "頭",
	feed: "足跡の巡回",
	fetch: "ページの読み込み",
	report: "頭が歩いていて気づいた",
	x: "X",
};
</script>

<div class="pane-head">
	<hgroup>
		<h2>弾かれたこと({data.open.length})</h2>
		<p>権限・鍵・上限が足りずに進めなかったこと。同じ先がうまくいったら自動で片づく。</p>
	</hgroup>
	<a class="button outline mini" href="https://github.com/danything/ashi/blob/main/docs/permissions.md" rel="noopener noreferrer" target="_blank">権限の付け方</a>
</div>

{#each data.open as b (b.key)}
	<article class="panel item">
		<div class="cluster">
			<span class="icon"><Icon name="alert" /></span>
			<strong class="grow">{b.title}</strong>
			<span class="tag warn">{SOURCE[b.source] ?? b.source}</span>
		</div>
		<p class="tiny muted nums">{b.count} 回・最初 {when(b.firstAt)}・最後 {when(b.lastAt)}</p>
		{#if b.detail}<pre class="detail tiny">{b.detail}</pre>{/if}
		<div class="note info small prose">{@html b.remedyHtml}</div>
		<form method="POST" action="/blocked?/resolve" use:enhance>
			<input type="hidden" name="key" value={b.key} />
			<button type="submit" class="outline mini"><Icon name="check" size={0.9} />対応した・気にしない</button>
		</form>
	</article>
{:else}
	<div class="panel all-clear">
		<span class="tag ok"><Icon name="check" size={0.9} />いま弾かれていることは無い</span>
	</div>
{/each}

{#if data.closed.length}
	<details class="fold">
		<summary>片づいたもの({data.closed.length})</summary>
		<ul class="rows">
			{#each data.closed as b (b.key)}
				<li><span class="grow small">{b.title}</span><span class="muted tiny nums">{when(b.resolvedAt)}</span></li>
			{/each}
		</ul>
	</details>
{/if}

<style>
	.item {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		border-left: 4px solid var(--ui-warn);
	}
	.icon {
		display: inline-flex;
		color: var(--ui-warn);
	}
	.detail {
		margin: 0;
		border-radius: 0.5rem;
		background: var(--ui-base-200);
		padding: 0.5rem 0.7rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	form {
		margin: 0;
	}
	.all-clear {
		display: flex;
		justify-content: center;
		padding: 1.5rem;
	}
</style>
