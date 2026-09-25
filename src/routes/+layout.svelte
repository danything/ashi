<script lang="ts">
import "@picocss/pico/css/pico.min.css";
import "../app.css";
import { page } from "$app/state";
import Icon, { type IconName } from "$lib/components/Icon.svelte";
import Logo from "$lib/components/Logo.svelte";

let { data, children } = $props();

/** ナビ。持ち主と頭の中は、学んだものを見る画面の後ろに */
const NAV: [string, string, IconName][] = [
	["/", "いま", "home"],
	["/chat", "話す", "message-circle"],
	["/notes", "ノート", "book"],
	["/questions", "問い", "help"],
	["/diary", "日記", "calendar"],
	["/owner", "持ち主", "user"],
	["/x", "X", "message-circle"],
	["/context", "頭の中", "brain"],
	["/proposals", "改善案", "wrench"],
];
const here = (href: string) =>
	(
		href === "/"
			? page.url.pathname === "/"
			: page.url.pathname.startsWith(href)
	)
		? "page"
		: undefined;
</script>

<svelte:head><title>Ashi</title></svelte:head>

{#if !data.user}
	{@render children()}
{:else}
	<div class="site">
		<header class="site-header">
			<div class="band"></div>
			<nav class="page-container bar">
				<a class="logo" href="/"><Logo />Ashi</a>
				<div class="grow"></div>
				<div class="nav-wide">
					{#each NAV as [href, label, icon] (href)}
						<a class="button ghost small" aria-current={here(href)} {href}>
							<Icon name={icon} size={1} />{label}
							{#if href === "/proposals" && data.proposals > 0}<span class="count">{data.proposals}</span>{/if}
						</a>
					{/each}
				</div>
				<!-- 狭い画面: 全部メニューに畳む -->
				<details class="dropdown nav-narrow">
					<!-- svelte-ignore a11y_no_redundant_roles -->
					<summary role="button" class="ghost small" aria-label="メニュー"><Icon name="menu" /></summary>
					<ul dir="rtl">
						{#each NAV as [href, label, icon] (href)}
							<li dir="ltr"><a {href} aria-current={here(href)}><Icon name={icon} size={1} />{label}</a></li>
						{/each}
					</ul>
				</details>
				<form method="POST" action="/logout" class="logout">
					<button type="submit" class="ghost small" title="{data.user.name} をログアウト" aria-label="ログアウト">
						<Icon name="log-out" size={1} />
					</button>
				</form>
			</nav>
		</header>

		{#if data.blocked > 0 && page.url.pathname !== "/blocked"}
			<a class="blocked-bar" href="/blocked">
				<Icon name="alert" size={1} />
				弾かれていることが {data.blocked} 件あります。権限を足すと先へ進めます
				<Icon name="arrow-right" size={1} />
			</a>
		{/if}

		<main class="page-container site-main">
			{@render children()}
		</main>

		<footer class="page-container site-footer">
			<span>Ashi — AIに、足を。</span>
			<span class="grow"></span>
			<a href="/blocked">弾かれたこと</a>
			<a href="https://github.com/danything/ashi/blob/main/docs/permissions.md" rel="noopener noreferrer" target="_blank">権限の付け方</a>
			<a href="https://github.com/danything/ashi" rel="noopener noreferrer" target="_blank">GitHub</a>
			<span>{data.user.name}</span>
		</footer>
	</div>
{/if}

<style>
	.site {
		display: flex;
		min-height: 100vh;
		flex-direction: column;
	}
	.site-header {
		position: sticky;
		top: 0;
		z-index: 30;
		border-bottom: 1px solid var(--ui-base-300);
		background: var(--ui-header-bg);
		backdrop-filter: blur(8px);
	}
	/* 色の帯はヘッダーの中に(外に置くと帯の分だけ余計にスクロールする) */
	.band {
		height: 0.2rem;
		background: linear-gradient(to right, var(--pico-primary-background), var(--ui-accent), var(--pico-primary-background));
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-height: var(--ui-header-h);
		padding: 0.25rem 1rem;
	}
	.logo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-right: 0.5rem;
		color: var(--pico-primary);
		font-size: 1.15rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-decoration: none;
	}
	.nav-wide {
		display: none;
		align-items: center;
		gap: 0.1rem;
	}
	.nav-narrow {
		margin: 0;
	}
	.count {
		min-width: 1.2rem;
		border-radius: 999px;
		background: var(--ui-accent);
		padding: 0 0.35rem;
		color: #fff;
		font-size: 0.7rem;
		line-height: 1.2rem;
		text-align: center;
	}
	.nav-narrow > summary::after {
		display: none;
	}
	.nav-narrow ul li a {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.nav-narrow ul li a[aria-current] {
		font-weight: 700;
	}
	@media (min-width: 1000px) {
		.nav-wide {
			display: flex;
		}
		.nav-narrow {
			display: none;
		}
	}
	.logout {
		margin: 0;
	}
	.blocked-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: var(--ui-warn-bg);
		padding: 0.55rem 1rem;
		color: var(--ui-warn);
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
	}
	.blocked-bar:hover {
		text-decoration: underline;
	}
	.site-main {
		flex: 1 1 auto;
		padding: 1.5rem 1rem 3rem;
	}
	.site-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 1rem;
		border-top: 1px solid var(--ui-base-300);
		padding: 0.9rem 1rem;
		color: var(--ui-muted);
		font-size: 0.78rem;
	}
	.site-footer a {
		color: inherit;
		text-decoration: none;
	}
	.site-footer a:hover {
		color: var(--pico-primary);
	}
</style>
