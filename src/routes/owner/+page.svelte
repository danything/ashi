<script lang="ts">
import { enhance } from "$app/forms";
import { when } from "$lib/format";

let { data, form } = $props();
</script>

<svelte:head><title>持ち主 | Ashi</title></svelte:head>

<main class="page stack">
	<hgroup>
		<h1>持ち主の興味の地図</h1>
		<p class="small muted">
			あなたの発言(話す)と、ここで渡した文章から頭が書き直す。「まだ知らなそうなこと」は先回りの問いになり、
			「発想の癖」の外側は個性の問いになる。
			{#if data.pending > 0}
				新しい材料が {data.pending} 件ある。{data.profileEvery} 歩ごとに書き直す。
			{/if}
		</p>
	</hgroup>

	<article class="panel pad prose">{@html data.html}</article>
	<form method="POST" action="?/reprofile" use:enhance>
		<button type="submit" class="outline">次の 1 歩で書き直させる</button>
	</form>

	{#if form?.message}<p class="note err small">{form.message}</p>{/if}
	{#if form && "added" in form}<p class="note ok small">渡した: {form.added}</p>{/if}

	<section class="panel body">
		<h2>足跡</h2>
		<p class="small muted">
			いつ読みに行くかは Ashi の頭が歩くたびに決める。足は同じ足跡を {data.feedMinHours} 時間空けずには読まない。
			足跡を増やすときは状態ディレクトリの ashi.json の <code>feeds</code> に書く。
		</p>
		{#each data.feeds as f (f.id)}
			<div class="cluster small">
				<span class="tag">{f.kind}</span>
				<span>{f.title ?? f.target}</span>
				<span class="grow"></span>
				{#if f.requested}<span class="tag info">次に読む</span>{/if}
				{#if f.state?.lastError}<span class="tag warn" title={f.state.lastError}>失敗</span>{/if}
				<span class="muted tiny">
					{f.state?.lastCrawledAt ? `${when(f.state.lastCrawledAt)}・新しいもの ${f.state.lastNew} 件` : "まだ読んでいない"}
				</span>
			</div>
		{:else}
			<p class="muted small">登録されていない。</p>
		{/each}
		{#if data.feeds.length}
			<form method="POST" action="?/crawl" use:enhance>
				<button type="submit" class="outline mini">次の 1 歩で全部読みに行かせる</button>
			</form>
		{/if}
	</section>

	<section class="panel body">
		<h2>書いたものを渡す</h2>
		<form method="POST" action="?/url" use:enhance class="stack tight">
			<label class="field"><span class="lab">ページの URL(ブログなど)</span>
				<input name="url" type="url" required placeholder="https://doany.io/posts/..." /></label>
			<label class="field"><span class="lab">題(空なら URL)</span><input name="title" /></label>
			<div><button type="submit">読み込む</button></div>
		</form>
		<hr />
		<form method="POST" action="?/paste" use:enhance class="stack tight">
			<label class="field"><span class="lab">題</span><input name="title" placeholder="メモ・議事録・書いた文章" /></label>
			<label class="field"><span class="lab">本文</span><textarea name="body" rows="6" required></textarea></label>
			<div><button type="submit">渡す</button></div>
		</form>
	</section>

	<section class="stack tight">
		<h2>渡したもの</h2>
		{#each data.sources as s (s.id)}
			<div class="cluster small">
				<span class="tag">{s.kind === "url" ? "URL" : s.kind === "feed" ? "足跡" : "貼り付け"}</span>
				{#if s.url}<a href={s.url} rel="noopener noreferrer" target="_blank">{s.title}</a>{:else}<span>{s.title}</span>{/if}
				<span class="grow"></span>
				<span class="muted tiny nums">{when(s.createdAt)}</span>
				<form method="POST" action="?/remove" use:enhance>
					<input type="hidden" name="id" value={s.id} />
					<button type="submit" class="outline mini">外す</button>
				</form>
			</div>
		{:else}
			<p class="muted small">まだ無い。</p>
		{/each}
	</section>
</main>
