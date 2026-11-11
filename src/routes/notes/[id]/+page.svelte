<script lang="ts">
  import Icon from "#lib/components/Icon.svelte";
  import { TRACK_LABEL, when } from "#lib/format.ts";

  let { data } = $props();
</script>

<svelte:head><title>{data.note.title} | Ashi</title></svelte:head>

<div class="stack">
  <a href="/notes" class="small back"
    ><Icon name="arrow-left" size={0.9} />ノート</a
  >
  <!-- 読み物は地にそのまま置く(枠も面も付けない)。系統・テーマ・日時は控えた字で -->
  <article class="stack">
    <div class="cluster muted small">
      <span
        >{#if data.question}{TRACK_LABEL[data.question.track]}・{/if}{data.note
          .theme}</span
      >
      <span class="grow"></span>
      <span class="nums">{when(data.note.createdAt)}</span>
    </div>
    <div class="prose">{@html data.html}</div>
  </article>
</div>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: var(--dp-space-1);
    align-self: flex-start;
    text-decoration: none;
  }
</style>
