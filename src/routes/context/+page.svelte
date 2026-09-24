<script lang="ts">
let { data } = $props();
</script>

<svelte:head><title>頭の中 | Ashi</title></svelte:head>

<main class="page stack">
	<hgroup>
		<h1>頭の中</h1>
		<p class="small muted">頭が毎回受け取っている文脈。ノートと問いは、この後に歩くたび足が添える。</p>
	</hgroup>

	<section class="stack tight">
		<h2>自己記述 <span class="tag">頭が内省のたびに書き直す</span></h2>
		<article class="panel pad prose">{@html data.self}</article>
	</section>

	<section class="stack tight">
		<h2>コア原則 <span class="tag">人が書く・頭は変えられない</span></h2>
		{#if !data.coreOk}
			<p class="note warn small">
				core.md が承認なしに変わっている。足は歩くのを止めている。サーバーで <code>ashi core --accept</code> を実行すると再開する。
			</p>
		{/if}
		<article class="panel pad prose">{@html data.core}</article>
	</section>

	<details class="fold">
		<summary>頭に渡している system の全文</summary>
		<pre class="inner small">{data.system}</pre>
	</details>
	<details class="fold">
		<summary>足の設定(ashi.json、範囲に丸めた後)</summary>
		<pre class="inner small">{data.config}</pre>
	</details>
</main>

<style>
	pre {
		white-space: pre-wrap;
	}
</style>
