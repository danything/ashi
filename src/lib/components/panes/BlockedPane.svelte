<script lang="ts">
  import { enhance } from "$app/forms";

  import Icon from "#lib/components/Icon.svelte";
  import { when } from "#lib/format.ts";
  import type { blockedView } from "#lib/server/views.ts";

  /** 弾かれたこと。フォームは /blocked の actions に送る */
  let { data }: { data: ReturnType<typeof blockedView> } = $props();

  const SOURCE: Record<string, string> = {
    head: "頭",
    feed: "足跡の巡回",
    fetch: "ページの読み込み",
    report: "頭が歩いていて気づいた",
    x: "X",
  };
</script>

<div class="pane-head">
  <span class="pane-name">弾かれたこと</span>
  <span class="count">{data.open.length} 件</span>
  <span
    class="hint"
    title="権限・鍵・ログインが足りずに進めなかったこと。同じ先がうまくいったら自動で片づく"
    >持ち主が権限を足せば進めること。うまくいったら自動で片づく</span
  >
  <a
    class="button outline mini"
    href="https://github.com/danything/ashi/blob/main/docs/permissions.md"
    rel="noopener noreferrer"
    target="_blank">権限の付け方</a
  >
</div>

<div class="item-list">
  {#each data.open as b (b.key)}
    <!-- 1 件ずつ件の面に乗せる。注意の印は頭のアイコンだけ(左の線は引かない) -->
    <article class="item blocked">
      <div class="cluster">
        <span class="icon"><Icon name="alert" /></span>
        <strong class="grow">{b.title}</strong>
      </div>
      <p class="tiny muted nums">
        {SOURCE[b.source] ?? b.source}・{b.count} 回・最初 {when(
          b.firstAt,
        )}・最後 {when(b.lastAt)}
      </p>
      {#if b.detail}<pre class="detail tiny">{b.detail}</pre>{/if}
      <div class="note info small prose">{@html b.remedyHtml}</div>
      <form method="POST" action="/blocked?/resolve" use:enhance>
        <input type="hidden" name="key" value={b.key} />
        <button type="submit" class="outline mini"
          ><Icon name="check" size={0.9} />対応した・気にしない</button
        >
      </form>
    </article>
  {:else}
    <p class="empty">いま弾かれていることは無い。</p>
  {/each}
</div>

{#if data.closed.length}
  <details class="fold">
    <summary>片づいたもの({data.closed.length})</summary>
    <ul class="rows">
      {#each data.closed as b (b.key)}
        <li>
          <span class="grow small">{b.title}</span><span class="muted tiny nums"
            >{when(b.resolvedAt)}</span
          >
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .blocked {
    display: flex;
    flex-direction: column;
    gap: var(--dp-space-2);
  }
  .icon {
    display: inline-flex;
    color: var(--dp-warn-text);
  }
  .detail {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
