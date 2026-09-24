<script lang="ts">
import { enhance } from "$app/forms";
import Icon from "$lib/components/Icon.svelte";
import { when } from "$lib/format";

let { data, form } = $props();
const KIND: Record<string, string> = {
	url: "URL",
	feed: "足跡",
	paste: "貼り付け",
};
</script>

<svelte:head><title>持ち主 | Ashi</title></svelte:head>

<div class="stack" style="--gap: 1.25rem">
	<div class="head">
		<hgroup>
			<h1>持ち主の興味の地図</h1>
			<p>
				あなたの発言と、渡した文章・足跡から頭が書き直す。「まだ知らなそうなこと」は先回りの問いになり、
				「発想の癖」の外側は個性の問いになる。
			</p>
		</hgroup>
		<form method="POST" action="?/reprofile" use:enhance>
			<button type="submit" class="outline small"><Icon name="sparkles" size={1} />次の 1 歩で書き直させる</button>
		</form>
	</div>

	{#if data.pending > 0}
		<p class="note info small">新しい材料が {data.pending} 件ある。{data.profileEvery} 歩ごとに書き直す。</p>
	{/if}
	{#if form?.message}<p class="note err small">{form.message}</p>{/if}
	{#if form && "added" in form}<p class="note ok small">渡した: {form.added}</p>{/if}

	<article class="panel doc prose">{@html data.html}</article>

	<div class="two">
		<section class="panel">
			<div class="panel-head">
				<h2>足跡</h2>
				{#if data.feeds.length}
					<form method="POST" action="?/crawl" use:enhance>
						<button type="submit" class="outline mini">全部読みに行かせる</button>
					</form>
				{/if}
			</div>
			<p class="tiny muted">
				いつ読みに行くかは頭が歩くたびに決める。同じ足跡は {data.feedMinHours} 時間空けて読む。
				足すときは deploy/deployment.yaml の <code>ASHI_FEEDS</code> に書く。
			</p>
			{#if data.feeds.length}
				<ul class="rows feeds">
					{#each data.feeds as f (f.id)}
						<li>
							<span class="tag">{f.kind}</span>
							<span class="grow">
								{f.title ?? f.target}
								<span class="muted tiny">
									{f.state?.lastCrawledAt
										? `${when(f.state.lastCrawledAt)} に読んだ・新しいもの ${f.state.lastNew} 件`
										: "まだ読んでいない"}
								</span>
							</span>
							{#if f.requested}<span class="tag info">次に読む</span>{/if}
							{#if f.state?.lastError}<a class="tag warn" href="/blocked" title={f.state.lastError}>失敗</a>{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">登録されていない。</p>
			{/if}
		</section>

		<section class="panel">
			<div class="panel-head"><h2>書いたものを渡す</h2></div>
			<div class="stack">
				<form method="POST" action="?/url" use:enhance class="stack tight">
					<label class="field"><span class="lab">ページの URL(ブログの記事など)</span>
						<input name="url" type="url" required placeholder="https://doany.io/posts/..." /></label>
					<label class="field"><span class="lab">題(空なら URL)</span><input name="title" /></label>
					<div><button type="submit" class="small"><Icon name="link" size={1} />読み込む</button></div>
				</form>
				<hr />
				<form method="POST" action="?/paste" use:enhance class="stack tight">
					<label class="field"><span class="lab">題</span><input name="title" placeholder="メモ・議事録・書いた文章" /></label>
					<label class="field"><span class="lab">本文</span><textarea name="body" rows="5" required></textarea></label>
					<div><button type="submit" class="small">渡す</button></div>
				</form>
			</div>
		</section>
	</div>

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
						<form method="POST" action="?/remove" use:enhance>
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
</div>

<style>
	.doc {
		max-width: none;
		padding: 1.5rem 1.75rem;
	}
	.rows form {
		margin: 0;
	}
	.feeds .grow {
		display: flex;
		flex-direction: column;
	}
	hr {
		margin: 0;
	}
</style>
