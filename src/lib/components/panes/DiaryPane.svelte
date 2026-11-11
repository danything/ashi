<script lang="ts">
  import type { diaryView } from "#lib/server/views.ts";

  /** 日記。日付は ?day= で選ぶ(いまの画面のまま切り替える) */
  let { data }: { data: ReturnType<typeof diaryView> } = $props();
  const label = (d: string) => d.slice(5).replace("-", "/");
</script>

<div class="pane-head">
  <span class="pane-name">日記</span>
  {#if data.day}
    <nav class="days hint" aria-label="日付">
      {#each data.days.slice(0, 14) as d (d)}
        <a
          href="?day={d}"
          data-sveltekit-noscroll
          data-sveltekit-keepfocus
          aria-current={d === data.day ? "page" : undefined}
          class="nums">{label(d)}</a
        >
      {/each}
    </nav>
  {/if}
</div>

{#if data.day}
  <article class="prose">{@html data.html}</article>
{:else}
  <div class="panel"><p class="empty">まだ日記が無い。</p></div>
{/if}

<style>
  /*
   * 日付の並び。枠も地も付けず、選んでいる日は主の色の太字と、字の幅いっぱいの下線(塗らない)。
   * Pico は nav の中身を左右に振り分けるので、左から詰める(日付が端から端まで散らばっていた)
   */
  .days {
    display: flex;
    justify-content: flex-start;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .days a {
    position: relative;
    flex: none;
    border-radius: var(--dp-radius-full);
    padding: 0.375rem var(--dp-space-3);
    color: var(--dp-fg);
    font-size: var(--dp-text-sm);
    text-decoration: none;
    transition: background-color var(--dp-duration) var(--dp-ease);
  }
  .days a:hover {
    background: var(--dp-hover-soft);
  }
  .days a:focus-visible {
    outline-offset: -2px;
  }
  .days a[aria-current="page"] {
    color: var(--dp-primary-text);
    font-weight: var(--dp-weight-bold);
  }
  .days a[aria-current="page"]::after {
    content: "";
    position: absolute;
    inset-inline: var(--dp-space-3);
    bottom: 0.2rem;
    height: var(--dp-mark);
    border-radius: var(--dp-mark);
    background: var(--pico-primary);
    pointer-events: none;
  }
</style>
