<script lang="ts">
import "../app.scss";
import { page } from "$app/state";

let { data, children } = $props();

const NAV = [
	["/", "いま"],
	["/chat", "話す"],
	["/notes", "ノート"],
	["/questions", "問い"],
	["/diary", "日記"],
	["/owner", "持ち主"],
	["/context", "頭の中"],
] as const;
const current = (href: string) =>
	(
		href === "/"
			? page.url.pathname === "/"
			: page.url.pathname.startsWith(href)
	)
		? "page"
		: undefined;
</script>

{#if data.user}
	<header class="bar">
		<nav class="cluster">
			<strong class="logo">足</strong>
			{#each NAV as [href, label] (href)}
				<a {href} aria-current={current(href)}>{label}</a>
			{/each}
			<span class="grow"></span>
			<span class="small muted">{data.user.name}</span>
			<form method="POST" action="/logout">
				<button type="submit" class="outline mini">ログアウト</button>
			</form>
		</nav>
	</header>
{/if}

{@render children()}

<style>
	.bar {
		border-bottom: 1px solid var(--ui-line);
		padding: 0.5rem 1rem;
	}
	.bar nav {
		max-width: 60rem;
		margin: 0 auto;
	}
	.logo {
		font-size: 1.2rem;
	}
	nav a {
		padding: 0.2rem 0.4rem;
		border-radius: 0.4rem;
		text-decoration: none;
	}
	nav a[aria-current="page"] {
		background: var(--pico-code-background-color);
		font-weight: 700;
	}
</style>
