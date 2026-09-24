<script lang="ts">
import Logo from "$lib/components/Logo.svelte";

let { data } = $props();
</script>

<svelte:head><title>ログイン | Ashi</title></svelte:head>

<main class="login">
	<div class="panel card stack">
		<div class="brand"><Logo />Ashi</div>
		<p class="lead">AIに、足を。</p>
		<p class="small muted">
			自分で歩き出し、行き先を選び、寄り道し、疲れたら休む AI です。
		</p>
		{#if data.configured}
			<a class="button big" href="/auth/login?to={encodeURIComponent(data.to)}" data-sveltekit-reload>
				Microsoft でログイン
			</a>
			<p class="tiny muted">持ち主のテナントで、アプリロールを割り当てられた人だけが入れます。</p>
		{:else}
			<p class="note warn small">
				Entra ID のログインが設定されていません(ENTRA_TENANT_ID・ENTRA_CLIENT_ID・ENTRA_CLIENT_SECRET・SESSION_SECRET)。
			</p>
		{/if}
	</div>
</main>

<style>
	.login {
		display: grid;
		min-height: 100vh;
		place-items: center;
		padding: 1rem;
	}
	.card {
		width: min(24rem, 100%);
		padding: 2rem 1.75rem;
		text-align: center;
	}
	.brand {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		color: var(--pico-primary);
		font-size: 1.6rem;
		font-weight: 700;
	}
	.brand :global(svg) {
		width: 2.4rem;
		height: 2.4rem;
	}
	.lead {
		font-size: 1.1rem;
		font-weight: 600;
	}
</style>
