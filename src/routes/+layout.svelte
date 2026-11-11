<script lang="ts">
  import "../app.css";
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";

  import Icon, { type IconName } from "#lib/components/Icon.svelte";
  import Logo from "#lib/components/Logo.svelte";
  import { markLite } from "#lib/lite.ts";

  let { data, children } = $props();

  /**
   * ナビ。束ねた画面(ノート | 日記、自分 | 持ち主の地図、改善案 | 弾かれたこと)は 1 つの画面に並べてあり、
   * 古い URL(/diary・/owner・/blocked)は束ねた画面へ送る。[先, 名前, アイコン, 同じ項目として光らせる先]
   */
  const NAV: [string, string, IconName, string[]][] = [
    ["/", "いま", "home", []],
    ["/chat", "話す", "message-circle", []],
    ["/notes", "ノート", "book", ["/diary"]],
    ["/questions", "問い", "help", []],
    ["/map", "つながり", "share", []],
    ["/context", "頭の中", "brain", ["/owner"]],
    ["/x", "X", "message-circle", []],
    ["/proposals", "直すこと", "wrench", ["/blocked"]],
    ["/settings", "設定", "sliders", []],
  ];
  /** 640px より狭い画面で下のタブに並べる数。残りは「その他」のメニューに入れる */
  const TABS = 4;
  const under = (path: string, href: string) =>
    href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
  const here = (href: string) =>
    [href, ...(NAV.find(([h]) => h === href)?.[3] ?? [])].some((h) =>
      under(page.url.pathname, h),
    )
      ? "page"
      : undefined;
  /** 「その他」に入れた画面にいるか(狭い画面では「その他」のタブに印を付ける) */
  const inMore = $derived(NAV.slice(TABS).some(([href]) => here(href)));
  /** 直すことの数(開いている改善案 + 弾かれていること) */
  const badge = (href: string) =>
    href === "/proposals" ? data.proposals + data.blocked : 0;

  // ソフトウェアで描いている端末では、動き続けるものを止める(app.css の最後)
  onMount(markLite);

  // 「その他」のメニューから画面を移ったら閉じる(開け閉めはブラウザの popover。動きは app.css の `.menu`)
  let more = $state<HTMLElement>();
  afterNavigate(() => {
    if (more?.matches(":popover-open")) more.hidePopover();
  });
</script>

<svelte:head><title>Ashi</title></svelte:head>

{#if !data.user}
  {@render children()}
{:else}
  <a class="skip" href="#main">本文へ移動</a>
  <div class="site">
    <!-- 広い形(1000px から)のヘッダー。操作の層: 上端では平らで、巻くと面と影が出る -->
    <header class="site-header">
      <nav class="bar" aria-label="画面">
        <a class="logo" href="/"><Logo />Ashi</a>
        <ul class="links">
          {#each NAV as [href, label, icon] (href)}
            <li>
              <a aria-current={here(href)} {href}>
                <Icon name={icon} size={1} />{label}
                {#if badge(href) > 0}<span class="count">{badge(href)}</span
                  >{/if}
              </a>
            </li>
          {/each}
        </ul>
        <form method="POST" action="/logout" class="logout">
          <button
            type="submit"
            class="ghost small"
            title="{data.user.name} をログアウト"
            aria-label="ログアウト"
          >
            <Icon name="log-out" size={1} />
          </button>
        </form>
      </nav>
    </header>

    {#if data.paused}
      <a class="note top-note" href="/">
        Ashi を止めています(歩み・X
        の自動返信を止めている。話すは使える)。再開は「いま」から
        <Icon name="arrow-right" size={1} />
      </a>
    {/if}
    {#if data.blocked > 0 && page.url.pathname !== "/proposals"}
      <a class="note warn top-note" href="/proposals">
        弾かれていることが {data.blocked} 件あります。権限を足すと先へ進めます
        <Icon name="arrow-right" size={1} />
      </a>
    {/if}

    <main id="main" tabindex="-1" class="page-container site-main">
      {@render children()}
    </main>

    <!-- スマホの形(1000px 未満)は上のヘッダーを出さず、下のタブに寄せる。いつも中身の上に浮いている -->
    <nav class="tabbar" aria-label="画面">
      {#each NAV as [href, label, icon], i (href)}
        <a class="tab" class:wide={i >= TABS} aria-current={here(href)} {href}>
          <Icon name={icon} />
          <span
            >{label}{#if badge(href) > 0}<span class="count">{badge(href)}</span
              >{/if}</span
          >
        </a>
      {/each}
      <button
        type="button"
        class="tab plain narrow"
        popovertarget="more-menu"
        aria-current={inMore ? "true" : undefined}
      >
        <Icon name="more" />
        <span
          >その他{#if badge("/proposals") > 0}<span class="count"
              >{badge("/proposals")}</span
            >{/if}</span
        >
      </button>
      <form method="POST" action="/logout" class="wide">
        <button
          type="submit"
          class="tab plain"
          title="{data.user.name} をログアウト"
        >
          <Icon name="log-out" />
          <span>ログアウト</span>
        </button>
      </form>
    </nav>
    <div id="more-menu" popover class="menu more-menu" bind:this={more}>
      {#each NAV.slice(TABS) as [href, label, icon] (href)}
        <a class="menu-item" aria-current={here(href)} {href}>
          <Icon name={icon} size={1} />{label}
          {#if badge(href) > 0}<span class="count">{badge(href)}</span>{/if}
        </a>
      {/each}
      <form method="POST" action="/logout">
        <button type="submit" class="menu-item plain">
          <Icon name="log-out" size={1} />{data.user.name} をログアウト
        </button>
      </form>
    </div>
  </div>
{/if}

<style>
  /*
   * 置き場は 2 つの形(denpa の docs/design.md の「浮かせ方」)。広い形(1000px から)は上のヘッダー、
   * スマホの形はヘッダーを出さず下のタブ。形は幅だけで決める(`app.css` の `--dp-tabbar`・`--dp-header-space`)
   */
  .site {
    display: flex;
    min-height: 100svh;
    flex-direction: column;
    gap: var(--dp-space-2);
    /* 浮いたヘッダーのぶん、中身の頭を空ける(広い形だけ。スマホの形は 0) */
    padding-top: var(--dp-header-space);
  }
  .site-main {
    flex: 1 1 auto;
    /* 下は、下のタブのぶんも空ける(スマホの形だけ)。話すの入力欄はこの高さに貼り付く */
    padding: var(--dp-space-2) var(--dp-gutter)
      calc(var(--dp-gutter) + var(--dp-tabbar));
  }
  /* 本文そのものは押すものではないので、焦点を移しても枠を描かない */
  .site-main:focus {
    outline: none;
  }
  /* 本文へ移動のリンク。ふだんは画面の上の外に置き、焦点が来たときだけ左上に操作の層のカプセルで出す */
  .skip {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + var(--dp-space-2));
    left: calc(env(safe-area-inset-left, 0px) + var(--dp-space-3));
    z-index: var(--dp-z-skip);
    border-radius: var(--dp-radius-full);
    background: var(--dp-float);
    box-shadow: var(--dp-shadow-pop);
    padding: var(--dp-space-2) var(--dp-space-4);
    color: var(--dp-fg);
    font-weight: var(--dp-weight-bold);
    text-decoration: none;
    translate: 0 calc(-100% - 2rem);
  }
  .skip:focus {
    translate: none;
  }
  /* 頭の通知(止めている・弾かれている)。淡い面とアイコンだけで、状態の色では塗らない(`app.css` の `.note`) */
  .top-note {
    display: flex;
    align-items: center;
    gap: var(--dp-space-2);
    margin-inline: var(--dp-gutter);
    font-size: var(--dp-text-sm);
    text-decoration: none;
  }
  .top-note:hover {
    text-decoration: underline;
  }
  /* 数(直すこと)。行のほかの字と同じ控えた字で、塗らない */
  .count {
    margin-inline-start: 0.25em;
    color: var(--dp-muted);
    font-variant-numeric: tabular-nums;
    font-weight: var(--dp-weight);
  }

  /*
   * ---- ヘッダー(広い形)。操作の層 ----
   * 窓の端から離した角丸の面。上端では平らで、巻いて中身が裏に入ったときだけ面と影が出る
   * (`animation-timeline: scroll()`。JS は使わない)。ぼかさない。
   * 対応していないブラウザと、動きを減らす設定の端末(Pico がアニメーションをすぐ終わらせる)は、いつも浮いた形
   */
  .site-header {
    display: none;
  }
  @keyframes header-float {
    from {
      background: transparent;
      box-shadow: none;
    }
    to {
      background: var(--dp-float);
      box-shadow: var(--dp-shadow-pop);
    }
  }
  @media (min-width: 1000px) {
    .site-header {
      position: fixed;
      top: 0.5rem;
      inset-inline: var(--dp-bar-inset);
      z-index: var(--dp-z-header);
      display: block;
      border-radius: var(--dp-bar-radius);
      background: var(--dp-float);
      box-shadow: var(--dp-shadow-pop);
    }
    @supports (animation-timeline: scroll()) {
      .site-header {
        background: transparent;
        box-shadow: none;
        animation: header-float linear both;
        animation-timeline: scroll(root block);
        animation-range: 0 1.5rem;
      }
    }
    /*
     * 巻けない画面(つながりの図・短いページ)に移ったら平らに戻す。巻けなくなると時間の軸が止まり、
     * Chrome は止まる前の値を残すので、上へ戻せる量が無いときはアニメーションごと外す
     */
    @supports (animation-timeline: scroll()) and (container-type: scroll-state) {
      :global(html) {
        container-type: scroll-state;
      }
      .site-header {
        animation-name: none;
      }
      @container scroll-state(scrollable: top) {
        .site-header {
          animation-name: header-float;
        }
      }
    }
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--dp-space-2);
    min-height: 3.25rem;
    padding: var(--dp-bar-pad) var(--dp-bar-pad) var(--dp-bar-pad)
      var(--dp-space-3);
  }
  .logo {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--dp-space-2);
    margin-right: var(--dp-space-2);
    color: var(--pico-primary);
    font-size: var(--dp-text-lg);
    font-weight: var(--dp-weight-bold);
    text-decoration: none;
  }
  /*
   * 画面へのリンク。通常は地を塗らず、字は本文(薄くしない)。いまいる画面は、塗らずに
   * 字の幅いっぱいの下線と主の色の太字。指を乗せたら地をごく薄く(選んでいる印とは混ぜない)
   */
  .links {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 2px;
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .links li {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .links a {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2.5rem;
    margin: 0;
    border-radius: var(--dp-radius-full);
    padding: 0 0.65rem;
    color: var(--dp-fg);
    font-size: var(--dp-text-sm);
    text-decoration: none;
    white-space: nowrap;
    transition: background-color var(--dp-duration) var(--dp-ease);
  }
  .links a:hover {
    background: var(--dp-hover-soft);
  }
  .links a[aria-current="page"] {
    color: var(--dp-primary-text);
    font-weight: var(--dp-weight-bold);
  }
  .links a[aria-current="page"]::after {
    content: "";
    position: absolute;
    inset-inline: 0.65rem;
    bottom: 0.2rem;
    height: var(--dp-mark);
    border-radius: var(--dp-mark);
    background: var(--pico-primary);
    pointer-events: none;
  }
  /*
   * 画面を移ると、下線が前の場所から横へ滑る。並びの疑似要素 1 本を CSS のアンカーでいまの項目に付ける。
   * アンカーに対応していないブラウザは、上の項目の中の線のまま(滑らない)
   */
  @supports (anchor-name: --a) {
    .links {
      position: relative;
      anchor-scope: --nav;
    }
    .links a[aria-current="page"] {
      anchor-name: --nav;
    }
    .links a[aria-current="page"]::after {
      content: none;
    }
    .links:has(a[aria-current="page"])::after {
      content: "";
      position: absolute;
      position-anchor: --nav;
      left: calc(anchor(left) + 0.65rem);
      right: calc(anchor(right) + 0.65rem);
      bottom: calc(anchor(bottom) + 0.2rem);
      height: var(--dp-mark);
      border-radius: var(--dp-mark);
      background: var(--pico-primary);
      pointer-events: none;
      transition:
        left var(--dp-duration-move) var(--dp-ease-spring),
        right var(--dp-duration-move) var(--dp-ease-spring);
    }
  }

  /*
   * ---- 下のタブ(スマホの形)。操作の層 ----
   * 左右と下から離したカプセルにして、いつも中身の上に浮かせる(いつも中身が裏を流れる)。面は `--dp-float`、ぼかさない。
   * 640px 未満は 5 つ(いま・話す・ノート・問い・その他)、640px からは全部の画面とログアウトを並べる(「その他」は出さない)。
   * 角は入れ子でそろえる: 外(2rem)= 中のタブ(1.75rem)+ 間の余白(0.25rem)
   */
  .tabbar {
    position: fixed;
    inset: auto var(--dp-dock-inset)
      calc(var(--dp-space-2) + env(safe-area-inset-bottom, 0px));
    z-index: var(--dp-z-header);
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    border-radius: 2rem;
    background: var(--dp-float);
    box-shadow: var(--dp-shadow-pop);
    padding: var(--dp-space-1);
  }
  .tab {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    width: 100%;
    min-height: 3.5rem;
    margin: 0;
    border: 0;
    border-radius: 1.75rem;
    background: transparent;
    box-shadow: none;
    padding: var(--dp-space-1) 0;
    color: inherit;
    font-size: var(--dp-text-2xs);
    font-weight: var(--dp-weight);
    line-height: 1.2;
    text-decoration: none;
    white-space: nowrap;
  }
  /* 乗せられる端末だけ(指で押すと、押したタブに地が残る) */
  @media (hover: hover) {
    .tab:hover {
      background: var(--dp-hover-soft);
    }
  }
  .tab:focus-visible {
    outline-offset: -2px;
  }
  /* いまの画面の印。ほかの横の並びと同じく、字の幅いっぱいの下線と主の色の太字 */
  .tab[aria-current] {
    color: var(--dp-primary-text);
    font-weight: var(--dp-weight-bold);
  }
  .tab > span {
    position: relative;
  }
  .tab[aria-current] > span::after {
    content: "";
    position: absolute;
    inset-inline: 0;
    top: calc(100% + 0.125rem);
    height: var(--dp-mark);
    border-radius: var(--dp-mark);
    background: var(--pico-primary);
    pointer-events: none;
  }
  @supports (anchor-name: --a) {
    .tabbar {
      anchor-scope: --tab;
    }
    .tab[aria-current] > span {
      anchor-name: --tab;
    }
    .tab[aria-current] > span::after {
      content: none;
    }
    .tabbar:has(.tab[aria-current])::before {
      content: "";
      position: absolute;
      position-anchor: --tab;
      left: anchor(left);
      right: anchor(right);
      top: calc(anchor(bottom) + 0.125rem);
      height: var(--dp-mark);
      border-radius: var(--dp-mark);
      background: var(--pico-primary);
      pointer-events: none;
      transition:
        left var(--dp-duration-move) var(--dp-ease-spring),
        right var(--dp-duration-move) var(--dp-ease-spring);
    }
  }
  .wide {
    display: none;
  }
  @media (min-width: 640px) {
    .wide {
      display: flex;
    }
    .narrow {
      display: none;
    }
  }
  /* 「その他」のメニュー。下のタブの右端にそろえ、すぐ上に出す(見た目は `app.css` の `.menu`) */
  .more-menu {
    position: fixed;
    right: var(--dp-dock-inset);
    bottom: calc(var(--dp-tabbar) + var(--dp-space-1));
  }
  @media (min-width: 1000px) {
    .tabbar,
    .more-menu {
      display: none;
    }
  }
</style>
