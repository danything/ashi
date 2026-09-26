<script lang="ts">
import { enhance } from "$app/forms";
import Icon from "$lib/components/Icon.svelte";
import { when } from "$lib/format";
import type { ownerView } from "$lib/server/views";

/** 持ち主の興味の地図と、その材料。フォームは /owner の actions に送る */
let {
	data,
	form,
}: {
	data: ReturnType<typeof ownerView>;
	form?: { message?: string; added?: string } | null;
} = $props();
const KIND: Record<string, string> = {
	url: "URL",
	feed: "足跡",
	paste: "貼り付け",
};
</script>

<div class="pane-head">
	<span class="pane-name">持ち主の地図</span>
	<span class="hint" title="あなたの発言・渡した文章・足跡から頭が書き直す">
		発言・渡した文章・足跡から頭が書き直す{data.pending > 0 ? `(新しい材料 ${data.pending} 件、${data.profileEvery} 歩ごと)` : ""}
	</span>
	<form method="POST" action="/owner?/reprofile" use:enhance>
		<button type="submit" class="outline mini"><Icon name="sparkles" size={0.9} />書き直させる</button>
	</form>
</div>

{#if form?.message}<p class="note err small">{form.message}</p>{/if}
{#if form?.added}<p class="note ok small">渡した: {form.added}</p>{/if}

<article class="panel doc prose">{@html data.html}</article>

<section class="panel">
	<div class="panel-head">
		<h2>足跡</h2>
		{#if data.feeds.length}
			<form method="POST" action="/owner?/crawl" use:enhance>
				<button type="submit" class="outline mini">全部読みに行かせる</button>
			</form>
		{/if}
	</div>
	<p class="tiny muted">
		いつ読みに行くかは頭が歩くたびに決める。同じ足跡は {data.feedMinHours} 時間空けて読む。足すときは deploy/deployment.yaml の <code>ASHI_FEEDS</code> に書く。
	</p>
	{#if data.feeds.length}
		<ul class="rows feeds">
			{#each data.feeds as f (f.id)}
				<li>
					<span class="tag">{f.kind}</span>
					<span class="grow">
						{f.title ?? f.target}
						<span class="muted tiny">
							{f.state?.lastCrawledAt ? `${when(f.state.lastCrawledAt)} に読んだ・新しいもの ${f.state.lastNew} 件` : "まだ読んでいない"}
						</span>
					</span>
					{#if f.requested}<span class="tag info">次に読む</span>{/if}
					{#if f.state?.lastError}<a class="tag warn" href="/proposals" title={f.state.lastError}>失敗</a>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">登録されていない。</p>
	{/if}
</section>

<section class="panel">
	<div class="panel-head"><h2>書いたものを渡す</h2></div>
	<div class="give">
		<form method="POST" action="/owner?/url" use:enhance class="stack tight">
			<label class="field"><span class="lab">ページの URL(ブログの記事など)</span>
				<input name="url" type="url" required placeholder="https://doany.io/posts/..." /></label>
			<label class="field"><span class="lab">題(空なら URL)</span><input name="title" /></label>
			<div><button type="submit" class="small"><Icon name="link" size={1} />読み込む</button></div>
		</form>
		<form method="POST" action="/owner?/paste" use:enhance class="stack tight">
			<label class="field"><span class="lab">題</span><input name="title" placeholder="メモ・議事録・書いた文章" /></label>
			<label class="field"><span class="lab">本文</span><textarea name="body" rows="3" required></textarea></label>
			<div><button type="submit" class="small">渡す</button></div>
		</form>
	</div>
</section>

<section class="panel">
	<div class="panel-head"><h2>渡したもの({data.sources.length})</h2></div>
	{#if data.sources.length}
		<ul class="rows">
			{#each data.sources as s (s.id)}
				<li>
					<span class="tag">{KIND[s.kind] ?? s.kind}</span>
					<span class="grow small">
						{#if s.url}<a href={s.url} rel="noopener noreferrer" target="_blank">{s.title}</a>{:else}{s.title}{/if}
					</span>
					<span class="muted tiny nums">{when(s.createdAt).slice(0, 10)}</span>
					<form method="POST" action="/owner?/remove" use:enhance>
						<input type="hidden" name="id" value={s.id} />
						<button type="submit" class="ghost mini">外す</button>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">まだ無い。</p>
	{/if}
</section>

<style>
	.doc {
		padding: 1.25rem 1.5rem;
	}
	.rows form {
		margin: 0;
	}
	.feeds .grow {
		display: flex;
		flex-direction: column;
	}
	.give {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
	}
</style>
