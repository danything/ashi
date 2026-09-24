<script lang="ts">
let { data } = $props();
</script>

<svelte:head><title>日記 {data.day} | Ashi</title></svelte:head>

<main class="page diary">
	<nav class="stack tight small">
		{#each data.days as d (d)}
			<a href="/diary/{d}" aria-current={d === data.day ? "page" : undefined}>{d.replaceAll("-", "/")}</a>
		{/each}
	</nav>
	<article class="prose">{@html data.html}</article>
</main>

<style>
	.diary {
		display: grid;
		gap: 1.5rem;
	}
	@media (width >= 48rem) {
		.diary {
			grid-template-columns: 9rem 1fr;
		}
	}
	nav a[aria-current="page"] {
		font-weight: 700;
	}
</style>
