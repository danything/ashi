<script lang="ts">
  import Logo from "#lib/components/Logo.svelte";

  let { data } = $props();
</script>

<svelte:head><title>ログイン | Ashi</title></svelte:head>

<!-- 1 つのことだけを言う、見せる画面。枠で囲まず左に揃え、地に主の色の淡い光を敷く(`app.css` の `.solo`・`.glow`) -->
<main class="solo glow">
  <div class="brand"><Logo />Ashi</div>
  <h1 class="lead">AIに、足を。</h1>
  <p class="small">
    自分で歩き出し、行き先を選び、寄り道し、疲れたら休む AI です。
  </p>
  {#if data.configured}
    <a
      class="button big"
      href="/auth/login?to={encodeURIComponent(data.to)}"
      data-sveltekit-reload
    >
      Microsoft でログイン
    </a>
    <p class="tiny">
      持ち主のテナントで、アプリロールを割り当てられた人だけが入れます。
    </p>
  {:else}
    <p class="note warn small">
      Entra ID
      のログインが設定されていません(ENTRA_TENANT_ID・ENTRA_CLIENT_ID・ENTRA_CLIENT_SECRET・SESSION_SECRET)。
    </p>
  {/if}
</main>

<style>
  .brand {
    display: flex;
    align-items: center;
    gap: var(--dp-space-3);
    color: var(--pico-primary);
    font-size: var(--dp-text-xl);
    font-weight: var(--dp-weight-bold);
  }
  .brand :global(svg) {
    width: 2.4rem;
    height: 2.4rem;
  }
  .lead {
    font-size: var(--dp-text-lg);
  }
  .button {
    margin-block: var(--dp-space-2);
  }
  /* 通知の字は本文の色のまま(`.solo p` の控えた字にしない) */
  .note {
    color: var(--dp-fg);
  }
</style>
