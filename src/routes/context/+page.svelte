<script lang="ts">
let { data } = $props();
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

	<details class="fold">
		<summary>頭に渡している system の全文</summary>
		<pre class="small">{data.system}</pre>
	</details>
	<details class="fold">
		<summary>足の設定(ashi.json と ASHI_CONFIG を重ね、範囲に丸めた後)</summary>
		<pre class="small">{data.config}</pre>
	</details>
</div>

<style>
	pre {
		margin: 0;
		white-space: pre-wrap;
	}
</style>
