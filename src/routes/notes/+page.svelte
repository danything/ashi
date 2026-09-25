<script lang="ts">
import Icon from "$lib/components/Icon.svelte";
import { TRACK_LABEL, when } from "$lib/format";

let { data } = $props();
</script>

<svelte:head><title>ノート | Ashi</title></svelte:head>

<div class="stack" style="--gap: 1.25rem">
	<div class="head">
		<hgroup>
			<h1>ノート</h1>
			<p>歩いて分かったこと。{data.notes.length} 件{data.q ? `(「${data.q}」で絞った)` : ""}。</p>
		</hgroup>
		<!-- Pico の role="group" で入力欄とボタンを 1 つにつなげる(fieldset の既定の役割も group だが、Pico は属性で見る) -->
		<form method="GET" class="search">
			<!-- svelte-ignore a11y_no_redundant_roles -->
			<fieldset role="group">
				<input name="q" type="text" value={data.q} placeholder="題・要約・テーマで探す" aria-label="探す" />
				<button type="submit"><Icon name="search" size={1} />探す</button>
			</fieldset>
		</form>
	</div>

	{#if data.notes.length}
		<div class="grid">
			{#each data.notes as n (n.id)}
				<a class="panel card" href="/notes/{n.id}">
					<div class="cluster">
						<span class="tag {n.track === 'owner' ? 'info' : 'accent'}">{TRACK_LABEL[n.track]}</span>
						<span class="muted tiny grow">{n.theme}</span>
						<span class="muted tiny nums">{when(n.createdAt).slice(0, 10)}</span>
					</div>
					<strong class="title">{n.title}</strong>
					<p class="small muted clamp3">{n.summary}</p>
				</a>
			{/each}
		</div>
	{:else}
		<div class="panel"><p class="empty">{data.q ? "見つからない。" : "まだノートが無い。"}</p></div>
	{/if}
</div>

<style>
	.search {
		width: min(22rem, 100%);
		margin: 0;
	}
	.search fieldset {
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		gap: 0.75rem;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		color: inherit;
		text-decoration: none;
		transition: border-color 0.15s;
	}
	.card:hover {
		border-color: var(--pico-primary);
	}
	.title {
		line-height: 1.45;
	}
	.clamp3 {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}
</style>
