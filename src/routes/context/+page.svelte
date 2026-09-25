<script lang="ts">
import { enhance } from "$app/forms";

let { data, form } = $props();
</script>

<svelte:head><title>頭の中 | Ashi</title></svelte:head>

<div class="stack" style="--gap: 1.25rem">
	<div class="head">
		<hgroup>
			<h1>頭の中</h1>
			<p>頭が毎回受け取っている文脈。ノートと問いは、歩くたびに足がこの後に添える。</p>
		</hgroup>
	</div>

	<div class="two">
		<section class="panel">
			<div class="panel-head">
				<h2>自己記述</h2>
				<span class="tag accent">頭が内省のたびに書き直す</span>
			</div>
			<div class="prose">{@html data.self}</div>
		</section>
		<section class="panel">
			<div class="panel-head">
				<h2>コア原則</h2>
				<span class="tag">人が書く・頭は変えられない</span>
			</div>
			{#if !data.coreOk}
				<p class="note warn small">
					core.md が承認なしに変わっている。足は歩くのを止めている。サーバーで <code>ashi core --accept</code> を実行すると再開する。
				</p>
			{/if}
			<div class="prose">{@html data.core}</div>
		</section>
	</div>

	<div class="two">
		<section class="panel">
			<div class="panel-head">
				<h2>次の一歩</h2>
				<span class="tag accent">前回の内省で決めた</span>
			</div>
			{#if data.intentions.length}
				<ul class="rows">
					{#each data.intentions as i, k (k)}<li class="small">{i}</li>{/each}
				</ul>
			{:else}
				<p class="empty">まだ無い。</p>
			{/if}
		</section>
		<section class="panel">
			<div class="panel-head">
				<h2>橋の候補({data.bridges.length})</h2>
				<span class="tag">個性で思いついた、まだ推測の持ち帰り</span>
			</div>
			{#if data.bridges.length}
				<ul class="rows">
					{#each data.bridges as b (b.id)}
						<li class="small">
							<span class="tag info">{b.toTheme}</span>
							<span class="grow">{b.idea}</span>
							{#if b.fromNoteId}<a class="tiny" href="/notes/{b.fromNoteId}">元のノート</a>{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">まだ無い。</p>
			{/if}
		</section>
	</div>

	<details class="fold">
		<summary>頭に渡している system の全文</summary>
		<pre class="small">{data.system}</pre>
	</details>

	<section class="panel danger">
		<div class="panel-head">
			<h2>学びをリセット</h2>
		</div>
		<p class="small">
			問い({data.counts.questions})・ノート({data.counts.notes})・日記・自己記述・橋の候補・次の一歩・歩数({data.counts.steps})を白紙に戻します。
			消さずに状態ディレクトリの <code>archive/</code> に移すので、あとから戻せます。
			コア原則・設定・持ち主の地図と渡した材料・改善案は残します。
		</p>
		{#if form?.message}<p class="note err small">{form.message}</p>{/if}
		{#if form && "archive" in form}<p class="note ok small">リセットした。前の学びは {form.archive} にある。</p>{/if}
		{#if data.stepping}
			<p class="note warn small">いま歩いている途中です。休みに入ってから押してください。</p>
		{/if}
		<form method="POST" action="?/reset" use:enhance class="cluster">
			<input name="confirm" placeholder="確かめに「リセット」と入れる" aria-label="確かめ" class="confirm" autocomplete="off" />
			<button type="submit" class="outline small reset" disabled={data.stepping}>学びをリセットする</button>
		</form>
	</section>

	<details class="fold">
		<summary>足の設定(ashi.json と ASHI_CONFIG を重ね、範囲に丸めた後)</summary>
		<pre class="small">{data.config}</pre>
	</details>
</div>

<style>
	.danger {
		border-color: var(--ui-err-bg);
	}
	.confirm {
		width: 16rem;
		margin: 0;
	}
	.reset {
		border-color: var(--ui-err);
		color: var(--ui-err);
	}
	pre {
		margin: 0;
		white-space: pre-wrap;
	}
</style>