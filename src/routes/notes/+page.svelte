<script lang="ts">
import Icon from "$lib/components/Icon.svelte";
import DiaryPane from "$lib/components/panes/DiaryPane.svelte";
import { TRACK_LABEL, when } from "$lib/format";

let { data } = $props();
</script>

<svelte:head><title>ノート | Ashi</title></svelte:head>

<h1 class="sr-only">ノートと日記</h1>
<div class="panes">
	<section class="pane">
		<div class="pane-head">
			<!-- Pico の role="group" で入力欄とボタンを 1 つにつなげる -->
			<form method="GET" class="search">
				<input type="hidden" name="day" value={data.diary.day ?? ""} />
				<!-- svelte-ignore a11y_no_redundant_roles -->
				<fieldset role="group">
					<input name="q" type="text" value={data.q} placeholder="ノートを探す(題・要約・テーマ)" aria-label="探す" />
					<button type="submit" class="small"><Icon name="search" size={1} /></button>
				</fieldset>
			</form>
		</div>
		{#if data.notes.length}
			<div class="panel">
				<ul class="rows">
					{#each data.notes as n (n.id)}
						<li>
							<a class="note-row" href="/notes/{n.id}">
								<span class="meta">
									<span class="tag {n.track === 'owner' ? 'info' : 'accent'}">{TRACK_LABEL[n.track]}</span>
									<span class="muted tiny">{n.theme}</span>
									<span class="muted tiny nums">{when(n.createdAt).slice(5, 16)}</span>
								</span>
								<strong class="title">{n.title}</strong>
								<span class="small muted clamp2">{n.summary}</span>
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{:else}
			<div class="panel"><p class="empty">{data.q ? "見つからない。" : "まだノートが無い。"}</p></div>
		{/if}
	</section>

	<section class="pane">
		<DiaryPane data={data.diary} />
	</section>
</div>

<style>
	.search {
		flex: 1;
		margin: 0;
	}
	.search fieldset {
		margin: 0;
	}
	.note-row {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.15rem 0;
		color: inherit;
		text-decoration: none;
	}
	.note-row:hover .title {
		color: var(--pico-primary);
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.meta .nums {
		margin-left: auto;
	}
	.title {
		line-height: 1.45;
	}
	.clamp2 {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}
</style>
