<script lang="ts">
import { enhance } from "$app/forms";
import { when } from "$lib/format";

let { data } = $props();

const SOURCE: Record<string, string> = {
	head: "頭(Claude API)",
	feed: "足跡の巡回",
	fetch: "ページの読み込み",
	report: "頭が歩いていて気づいた",
};
</script>

<svelte:head><title>弾かれたこと | Ashi</title></svelte:head>

<main class="page stack">
	<hgroup>
		<h1>弾かれたこと</h1>
		<p class="small muted">
			権限・鍵・課金が足りずに進めなかったこと。初めて起きたときに通知する(NOTIFY_WEBHOOK_URL)。
			同じ先がうまくいったら自動で片づく。権限の付け方の一覧はリポジトリの docs/permissions.md にある。
		</p>
	</hgroup>

	{#each data.open as b (b.key)}
		<article class="panel body">
			<div class="cluster">
				<span class="tag warn">{SOURCE[b.source] ?? b.source}</span>
				<strong class="grow">{b.title}</strong>
				<span class="tiny muted nums">{b.count} 回・最後 {when(b.lastAt)}</span>
			</div>
			{#if b.detail}<p class="small muted detail">{b.detail}</p>{/if}
			<div class="note info small prose">{@html b.remedyHtml}</div>
			<form method="POST" action="?/resolve" use:enhance>
				<input type="hidden" name="key" value={b.key} />
				<button type="submit" class="outline mini">対応した・気にしない</button>
			</form>
		</article>
	{:else}
		<p class="note ok">いま弾かれていることは無い。</p>
	{/each}

	{#if data.closed.length}
		<details class="fold">
			<summary>片づいたもの</summary>
			<ul class="inner small">
				{#each data.closed as b (b.key)}
					<li>{b.title} <span class="muted tiny">{when(b.resolvedAt)}</span></li>
				{/each}
			</ul>
		</details>
	{/if}
</main>

<style>
	.detail {
		overflow-wrap: anywhere;
	}
</style>
