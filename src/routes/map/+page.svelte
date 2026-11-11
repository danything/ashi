<script lang="ts">
  import type { ForceGraph3DInstance } from "3d-force-graph";
  import { onMount, untrack } from "svelte";

  import Icon from "#lib/components/Icon.svelte";
  import { TRACK_LABEL, when } from "#lib/format.ts";
  import type { MapLink, MapNode } from "#lib/server/ashi/map.ts";

  let { data } = $props();

  type GNode = MapNode & { x?: number; y?: number; z?: number };
  type GLink = Omit<MapLink, "source" | "target"> & {
    source: string | GNode;
    target: string | GNode;
  };

  // 3D の図は点に座標を書き込むので、画面の data とは別の、ただのオブジェクトにしておく
  // (開いた時点の地図を見せる。歩みが進んだら開き直す)
  const all: GNode[] = untrack(() => data.map.nodes.map((n) => ({ ...n })));
  const links: MapLink[] = untrack(() => data.map.links);

  /** 時間を巻き戻す目盛り。点が生まれた時刻(分まで)を並べる */
  const steps = [...new Set(all.map((n) => n.at.slice(0, 16)))].sort();
  let step = $state(steps.length - 1);
  let playing = $state(false);
  const cutoff = $derived(`${steps[step] ?? ""}￿`);

  let showNear = $state(true);
  let showNotes = $state(true);
  let showClosed = $state(true);
  let selected = $state<GNode | undefined>();
  let shown = $state({ nodes: 0, links: 0 });

  let el = $state<HTMLDivElement>();
  let graph: ForceGraph3DInstance | undefined;

  const KIND_LABEL: Record<string, string> = {
    note: "ノート",
    origin: "出どころ",
    idea: "橋の候補",
    owner: "持ち主",
  };
  const STATUS_LABEL: Record<string, string> = {
    open: "開いている",
    answered: "答えた",
    dropped: "手放した",
    parked: "未測定の棚",
  };

  const LEGEND_NODES = [
    ["owner", "先回りの問い"],
    ["self", "個性の問い"],
    ["closed", "閉じた問い"],
    ["note", "ノート"],
    ["origin", "出どころ"],
    ["idea", "橋の候補"],
    ["me", "持ち主"],
  ] as const;
  const LEGEND_LINKS = [
    ["parent", "歩いて生まれた"],
    ["bridge", "個性から持ち帰った"],
    ["near", "文字が近い(ゆるい連想)"],
    ["merged", "統合した"],
  ] as const;

  const css = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function palette() {
    return {
      bg: css("--dp-bg") || "#fff",
      owner: css("--pico-primary") || "#0172ad",
      self: css("--ui-accent") || "#5f8f3e",
      closed: css("--dp-line-strong") || "#cfd5e2",
      note: css("--dp-muted") || "#555e70",
      origin: css("--dp-warn") || "#c79400",
      idea: "#8b6fd6",
      me: css("--dp-rec") || "#d93526",
      line: css("--dp-muted") || "#555e70",
    };
  }
  type Palette = ReturnType<typeof palette>;
  let colors: Palette | undefined;

  const isClosed = (n: GNode) =>
    n.kind === "question" && n.status !== "open" && n.status !== "parked";

  function nodeColor(n: GNode, c: Palette): string {
    if (n.kind === "question")
      return isClosed(n) ? c.closed : n.track === "owner" ? c.owner : c.self;
    if (n.kind === "note") return c.note;
    if (n.kind === "origin") return c.origin;
    if (n.kind === "idea") return c.idea;
    return c.me;
  }

  function linkColor(l: GLink, c: Palette): string {
    if (l.kind === "bridge") return c.self;
    if (l.kind === "idea") return c.idea;
    if (l.kind === "origin") return c.origin;
    if (l.kind === "merged") return c.closed;
    return c.line;
  }

  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch] ?? ch,
    );

  function tip(n: GNode): string {
    const kind =
      n.kind === "question"
        ? `${TRACK_LABEL[n.track ?? "owner"]}の問い`
        : (KIND_LABEL[n.kind] ?? "");
    return `<div class="map-tip"><small>${esc(kind)}${n.theme ? ` ・ ${esc(n.theme)}` : ""}</small><br>${esc(n.label.slice(0, 140))}</div>`;
  }

  /**
   * 同じテーマの点をゆるく寄せる力。テーマを点にすると全部がそこへ吸い寄せられたので、
   * 重心へ少しずつ引くだけにする
   */
  function themeForce() {
    let nodes: GNode[] = [];
    const force = (alpha: number) => {
      const sum = new Map<
        string,
        { x: number; y: number; z: number; n: number }
      >();
      for (const n of nodes) {
        if (!n.theme || n.x === undefined) continue;
        const s = sum.get(n.theme) ?? { x: 0, y: 0, z: 0, n: 0 };
        s.x += n.x;
        s.y += n.y ?? 0;
        s.z += n.z ?? 0;
        s.n++;
        sum.set(n.theme, s);
      }
      const k = 0.05 * alpha;
      for (const n of nodes as (GNode & {
        vx?: number;
        vy?: number;
        vz?: number;
      })[]) {
        const s = n.theme ? sum.get(n.theme) : undefined;
        if (!s || s.n < 2 || n.x === undefined) continue;
        n.vx = (n.vx ?? 0) + (s.x / s.n - n.x) * k;
        n.vy = (n.vy ?? 0) + (s.y / s.n - (n.y ?? 0)) * k;
        n.vz = (n.vz ?? 0) + (s.z / s.n - (n.z ?? 0)) * k;
      }
    };
    force.initialize = (ns: object[]) => {
      nodes = ns as GNode[];
    };
    return force;
  }

  /**
   * ズーム(カメラの位置と向き)を端末ごとに覚える。配置とズームはライブラリの標準の自動計算に任せ、
   * こちらで動かさない(寄せ直しや配置の記憶は、かえって動きが不自然だった。持ち主の判断、2026-09-27)。
   * 覚えたときより点が ZOOM_RESET_NODES 個以上増えていたら、覚えたズームは使わず標準の表示に戻す
   */
  const ZOOM_KEY = "ashi-map-zoom-v1";
  const ZOOM_RESET_NODES = 50;
  type Vec = { x: number; y: number; z: number };

  function loadZoom(nodes: number): { pos: Vec; target: Vec } | undefined {
    try {
      // 前の版が覚えていた配置は使わなくなったので消す
      localStorage.removeItem("ashi-map-positions-v1");
      const z = JSON.parse(localStorage.getItem(ZOOM_KEY) ?? "null") as {
        pos: Vec;
        target: Vec;
        nodes: number;
      } | null;
      if (!z) return undefined;
      if (nodes - z.nodes >= ZOOM_RESET_NODES) {
        localStorage.removeItem(ZOOM_KEY);
        return undefined;
      }
      return z;
    } catch {
      return undefined;
    }
  }

  function saveZoom(pos: Vec, target: Vec, nodes: number) {
    try {
      localStorage.setItem(ZOOM_KEY, JSON.stringify({ pos, target, nodes }));
    } catch {
      // 覚えられなくても困らない(次も標準の表示で出るだけ)
    }
  }

  function visible(n: GNode): boolean {
    if (n.at > cutoff) return false;
    if (!showNotes && (n.kind === "note" || n.kind === "idea")) return false;
    if (!showClosed && isClosed(n)) return false;
    return true;
  }

  function apply() {
    if (!graph) return;
    const nodes = all.filter(visible);
    const ids = new Set(nodes.map((n) => n.id));
    const ls: GLink[] = links
      .filter(
        (l) =>
          l.at <= cutoff &&
          (showNear || l.kind !== "near") &&
          ids.has(l.source) &&
          ids.has(l.target),
      )
      .map((l) => ({ ...l }));
    shown = { nodes: nodes.length, links: ls.length };
    graph.graphData({ nodes, links: ls });
  }

  function focus(n: GNode) {
    selected = n;
    if (!graph || n.x === undefined) return;
    const d = 90;
    const r = 1 + d / (Math.hypot(n.x, n.y ?? 0, n.z ?? 0) || 1);
    graph.cameraPosition(
      { x: n.x * r, y: (n.y ?? 0) * r, z: (n.z ?? 0) * r },
      { x: n.x, y: n.y ?? 0, z: n.z ?? 0 },
      800,
    );
  }

  onMount(() => {
    let alive = true;
    const resize = new ResizeObserver(() => {
      if (el) graph?.width(el.clientWidth).height(el.clientHeight);
    });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const recolor = () => {
      colors = palette();
      graph?.backgroundColor(colors.bg).refresh();
    };
    (async () => {
      const { default: ForceGraph3D } = await import("3d-force-graph");
      if (!alive || !el) return;
      colors = palette();
      const c = () => colors ?? palette();
      graph = new ForceGraph3D(el, { controlType: "orbit" })
        .width(el.clientWidth)
        .height(el.clientHeight)
        .backgroundColor(c().bg)
        .showNavInfo(false)
        .nodeId("id")
        .nodeVal(
          (n) =>
            Math.max(1, (n as GNode).weight) *
            ((n as GNode).kind === "question" ? 2 : 1.5),
        )
        .nodeColor((n) => nodeColor(n as GNode, c()))
        .nodeOpacity(0.92)
        .nodeResolution(12)
        .nodeLabel((n) => tip(n as GNode))
        .linkColor((l) => linkColor(l as GLink, c()))
        .linkOpacity(0.35)
        .linkWidth((l) =>
          (l as GLink).kind === "near"
            ? 0
            : (l as GLink).kind === "bridge"
              ? 1.4
              : 0.6,
        )
        .linkDirectionalParticles((l) =>
          (l as GLink).kind === "parent" || (l as GLink).kind === "bridge"
            ? 2
            : 0,
        )
        .linkDirectionalParticleSpeed(0.006)
        .linkDirectionalParticleWidth(1.6)
        .onNodeClick((n) => focus(n as GNode))
        .onBackgroundClick(() => {
          selected = undefined;
        });
      graph.d3Force("theme", themeForce());
      apply();
      // 覚えたズームがあれば戻す(ライブラリが標準のカメラを置いた後に)
      const saved = loadZoom(all.length);
      if (saved)
        requestAnimationFrame(() =>
          graph?.cameraPosition(saved.pos, saved.target, 0),
        );
      // 回したり寄ったりして手を止めたら、そのズームを覚える
      const controls = graph.controls() as {
        target?: Vec;
        addEventListener?: (type: string, fn: () => void) => void;
      };
      controls.addEventListener?.("end", () => {
        if (!graph) return;
        const p = graph.cameraPosition();
        const t = controls.target ?? { x: 0, y: 0, z: 0 };
        saveZoom(
          { x: p.x, y: p.y, z: p.z },
          { x: t.x, y: t.y, z: t.z },
          all.length,
        );
      });
    })();
    if (el) resize.observe(el);
    scheme.addEventListener("change", recolor);
    return () => {
      alive = false;
      resize.disconnect();
      scheme.removeEventListener("change", recolor);
      graph?._destructor();
    };
  });

  $effect(() => {
    // 目盛り・表示の切り替えで描き直す
    void [cutoff, showNear, showNotes, showClosed];
    apply();
  });

  $effect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (step >= steps.length - 1) playing = false;
      else step++;
    }, 500);
    return () => clearInterval(timer);
  });

  function play() {
    if (!playing && step >= steps.length - 1) step = 0;
    playing = !playing;
  }
</script>

<svelte:head><title>つながり | Ashi</title></svelte:head>

<!-- 図を画面いっぱいにし、操作・凡例・中身は図の上に重ねる(縦も横も図に使う) -->
{#if all.length}
  <div class="map-wrap">
    <div class="canvas" bind:this={el}></div>

    <div class="overlay float controls">
      <div class="row head-row">
        <button
          type="button"
          class="mini"
          onclick={play}
          disabled={steps.length < 2}
        >
          <Icon name={playing ? "check" : "arrow-right"} size={0.9} />{playing
            ? "止める"
            : "育ち方を再生"}
        </button>
        <span class="tiny muted nums stat"
          >{when(steps[step])} まで ・ 点 {shown.nodes} ・ 線 {shown.links}</span
        >
      </div>
      <input
        type="range"
        min="0"
        max={steps.length - 1}
        bind:value={step}
        aria-label="いつまでを見せるか"
      />
      <div class="row toggles">
        <label
          ><input
            type="checkbox"
            role="switch"
            bind:checked={showNear}
          />ゆるい連想</label
        >
        <label
          ><input
            type="checkbox"
            role="switch"
            bind:checked={showNotes}
          />ノートと橋の候補</label
        >
        <label
          ><input
            type="checkbox"
            role="switch"
            bind:checked={showClosed}
          />閉じた問い</label
        >
      </div>
    </div>

    <div class="overlay float legend">
      {#each LEGEND_NODES as [k, label] (k)}
        <span><i class="dot k-{k}"></i>{label}</span>
      {/each}
      {#each LEGEND_LINKS as [k, label] (k)}
        <span><i class="bar k-{k}"></i>{label}</span>
      {/each}
      <span class="muted">ドラッグで回す・ホイールで寄る・点を押すと中身</span>
    </div>

    {#if selected}
      <aside class="overlay float detail">
        <div class="cluster">
          <span class="muted tiny grow">
            {#if selected.kind === "question"}
              {TRACK_LABEL[selected.track ?? "owner"]}・{STATUS_LABEL[
                selected.status ?? ""
              ] ?? selected.status}
            {:else}
              {KIND_LABEL[selected.kind]}
            {/if}{selected.theme ? `・${selected.theme}` : ""}
          </span>
          <button
            type="button"
            class="ghost small close"
            aria-label="閉じる"
            onclick={() => (selected = undefined)}>×</button
          >
        </div>
        <p>{selected.label}</p>
        <div class="cluster">
          <span class="muted tiny nums grow">{when(selected.at)}</span>
          {#if selected.href}<a class="small" href={selected.href}
              >開く<Icon name="arrow-right" size={0.9} /></a
            >{/if}
        </div>
      </aside>
    {/if}
  </div>
{:else}
  <div class="panel"><p class="empty">まだ問いが無い。</p></div>
{/if}

<style>
  /*
   * ヘッダーの下を全部、図に使う(ページの余白も外す)。自分で画面を埋める画面なので、箱は浮いたヘッダーの
   * 下から始める(窓が巻けないので、ヘッダーはいつも平ら)。スマホの形では図を画面の下の端まで伸ばし、下のタブを図の上に浮かせる
   */
  :global(div.site:has(.map-wrap)) {
    height: 100svh;
    overflow: hidden;
  }
  :global(main.site-main:has(.map-wrap)) {
    display: flex;
    min-height: 0;
    flex-direction: column;
    padding: 0;
  }
  .map-wrap {
    position: relative;
    flex: 1 1 0;
    min-height: 20rem;
    overflow: hidden;
    background: var(--dp-bg);
  }
  .canvas {
    position: absolute;
    inset: 0;
  }
  /*
   * 図の上に重ねる操作・凡例・中身。動く図の上に重なるので操作の層(`app.css` の `.float`:
   * 面と影だけ。縁もぼかしも付けない)。中のボタンは浮かせず太字だけ
   */
  .overlay {
    position: absolute;
    z-index: 2;
    padding: var(--dp-space-2) var(--dp-space-3);
  }
  .controls {
    top: var(--dp-space-3);
    left: var(--dp-space-3);
    display: grid;
    gap: var(--dp-space-1);
    width: min(30rem, calc(100% - 1.5rem));
  }
  /* 再生中に数の桁が変わっても、折り返したり戻ったりして枠の高さが揺れないように */
  .head-row {
    flex-wrap: nowrap;
  }
  .head-row button {
    flex: none;
  }
  .stat {
    min-width: 0;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--dp-space-1) var(--dp-space-3);
  }
  .controls input[type="range"] {
    margin: 0;
  }
  .toggles label {
    margin: 0;
    font-size: var(--dp-text-xs);
  }
  .legend {
    /* スマホの形では、下のタブのすぐ上 */
    bottom: calc(var(--dp-tabbar) + var(--dp-space-3));
    left: var(--dp-space-3);
    display: flex;
    flex-wrap: wrap;
    gap: var(--dp-space-1) var(--dp-space-3);
    max-width: calc(100% - 1.5rem);
    font-size: var(--dp-text-xs);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: var(--dp-space-1);
  }
  .detail {
    top: var(--dp-space-3);
    right: var(--dp-space-3);
    width: min(22rem, calc(100% - 1.5rem));
    max-height: calc(100% - 5rem);
    overflow: auto;
  }
  .detail p {
    margin: var(--dp-space-2) 0;
  }
  .close {
    padding: 0 var(--dp-space-2);
    line-height: 1.4;
  }
  /* 凡例の印。k- を付けるのは、全体の .note(お知らせの枠)などと名前がぶつかって形が崩れたから */
  .dot {
    display: inline-block;
    flex: none;
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
  }
  .bar {
    display: inline-block;
    flex: none;
    width: 1.1rem;
    height: 2px;
    background: var(--dp-muted);
  }
  /* 点の色は図の中の種類の見本(図の中だけ)。先回りは主の色、個性は葦の緑 */
  .k-owner {
    background: var(--pico-primary);
  }
  .k-self,
  .bar.k-bridge {
    background: var(--ui-accent);
  }
  .bar.k-bridge {
    height: 3px;
  }
  .k-closed,
  .bar.k-merged {
    background: var(--dp-line-strong);
  }
  .k-note {
    background: var(--dp-muted);
  }
  .k-origin {
    background: var(--dp-warn);
  }
  .k-idea {
    background: #8b6fd6;
  }
  .k-me {
    background: var(--dp-rec);
  }
  .bar.k-near {
    height: 1px;
    opacity: 0.5;
  }
  /* 点に乗せたときの一言。メニューと同じ面と影(縁は付けない) */
  :global(.map-tip) {
    max-width: 20rem;
    border-radius: var(--dp-radius);
    background: var(--dp-pop);
    box-shadow: var(--dp-shadow-pop);
    padding: var(--dp-space-2) var(--dp-space-3);
    color: var(--dp-fg);
    font-size: var(--dp-text-sm);
    line-height: 1.5;
    white-space: normal;
  }
  :global(.map-tip small) {
    color: var(--dp-muted);
  }
</style>
