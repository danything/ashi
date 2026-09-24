<script lang="ts">
let { data } = $props();
</script>

<svelte:head><title>ログイン | Ashi</title></svelte:head>

<main class="page login stack">
	<hgroup>
		<h1>Ashi</h1>
		<p class="muted">AIに、足を。</p>
	</hgroup>
	{#if data.configured}
		<a class="button big" href="/auth/login?to={encodeURIComponent(data.to)}" data-sveltekit-reload>
			Microsoft でログイン
		</a>
		<p class="small muted">持ち主のテナントで、アプリロールを割り当てられた人だけが入れます。</p>
	{:else}
		<p class="note warn">Entra ID のログインが設定されていません(ENTRA_TENANT_ID・ENTRA_CLIENT_ID・ENTRA_CLIENT_SECRET・SESSION_SECRET)。</p>
	{/if}
</main>

<style>
	.login {
		max-width: 24rem;
		margin: 18vh auto 0;
		text-align: center;
	}
</style>
