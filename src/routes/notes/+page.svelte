<script lang="ts">
  import Icon from "#lib/components/Icon.svelte";
  import DiaryPane from "#lib/components/panes/DiaryPane.svelte";
  import { TRACK_LABEL, when } from "#lib/format.ts";

  let { data } = $props();
</script>

<svelte:head><title>ノート | Ashi</title></svelte:head>

<h1 class="sr-only">ノートと日記</h1>
<div class="panes">
  <section class="pane">
    <div class="pane-head">
      <span class="pane-name">ノート</span>
      <span class="count">{data.notes.length} 件</span>
      <!-- Pico の role="group" で入力欄とボタンを 1 つにつなげる -->
      <form method="GET" class="search">
        <input type="hidden" name="day" value={data.diary.day ?? ""} />
        <!-- svelte-ignore a11y_no_redundant_roles -->
        <fieldset role="group">
          <input
            name="q"
            type="text"
            value={data.q}
            placeholder="ノートを探す(題・要約・テーマ)"
            aria-label="探す"
          />
          <button type="submit" class="small"
            ><Icon name="search" size={1} /></button
          >
        </fieldset>
      </form>
    </div>
    {#if data.notes.length}
      <div class="panel">
        <ul class="item-list">
          {#each data.notes as n (n.id)}
            <li class="item note-item">
              <a class="note-row" href="/notes/{n.id}">
                <strong class="title">{n.title}</strong>
                <span class="small muted clamp2">{n.summary}</span>
                <span class="meta muted tiny">
                  <span>{TRACK_LABEL[n.track]}・{n.theme}</span>
                  <span class="nums">{when(n.createdAt).slice(5, 16)}</span>
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </div>
    {:else}
      <div class="panel">
        <p class="empty">{data.q ? "見つからない。" : "まだノートが無い。"}</p>
      </div>
    {/if}
  </section>

  <section class="pane">
    <DiaryPane data={data.diary} />
  </section>
</div>

<style>
  .search {
    flex: 1;
    margin: 0;
  }
  .search fieldset {
    margin: 0;
  }
  /* 件いっぱいを押せる。余白はリンクの側に持たせ、焦点の線は内側に引く */
  .note-item {
    padding: 0;
  }
  .note-row {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    flex-direction: column;
    gap: 0.125rem;
    border-radius: inherit;
    padding: var(--dp-space-3) var(--dp-space-4);
    color: inherit;
    text-decoration: none;
  }
  .note-row:focus-visible {
    outline-offset: -2px;
  }
  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--dp-space-2);
  }
  .title {
    line-height: 1.45;
  }
</style>
