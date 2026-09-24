<script lang="ts">
let { data } = $props();
const label = (d: string) => d.replaceAll("-", "/");
</script>

<svelte:head><title>日記 {label(data.day)} | Ashi</title></svelte:head>

<div class="stack" style="--gap: 1.25rem">
	<div class="head">
		<hgroup>
			<h1>日記</h1>
			<p>内省の順番が来たとき、疲れたときに書く。</p>
		</hgroup>
	</div>
	<div class="diary">
		<nav class="panel days" aria-label="日付">
			{#each data.days as d (d)}
				<a href="/diary/{d}" aria-current={d === data.day ? "page" : undefined} class="nums">{label(d)}</a>
			{/each}
		</nav>
		<article class="panel doc prose">{@html data.html}</article>
	</div>
</div>

<style>
	.diary {
		display: grid;
		gap: 1rem;
		align-items: start;
	}
	@media (min-width: 800px) {
		.diary {
			grid-template-columns: 10rem minmax(0, 1fr);
		}
		.days {
			position: sticky;
			top: calc(var(--ui-header-h) + 1rem);
		}
	}
	.days {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem;
		padding: 0.5rem;
	}
	@media (min-width: 800px) {
		.days {
			flex-direction: column;
		}
	}
	.days a {
		border-radius: 0.5rem;
		padding: 0.35rem 0.6rem;
		color: inherit;
		font-size: 0.875rem;
		text-decoration: none;
	}
	.days a:hover {
		background: var(--ui-base-200);
	}
	.days a[aria-current="page"] {
		background: var(--ui-base-200);
		color: var(--pico-primary);
		font-weight: 700;
	}
	.doc {
		max-width: none;
		padding: 1.5rem 1.75rem;
	}
</style>
