<script lang="ts">
import { enhance } from "$app/forms";
import OwnerPane from "$lib/components/panes/OwnerPane.svelte";
import { when } from "$lib/format";

let { data, form } = $props();
/** 橋の候補は増えていくので、新しいものだけ先に見せる */
const BRIDGES_SHOWN = 6;
</script>

<svelte:head><title>頭の中 | Ashi</title></svelte:head>

<h1 class="sr-only">頭の中</h1>
<!-- 自分(自己記述)と持ち主の地図を並べる。個性が持ち主の写しになっていないかを見比べられるように -->
<div class="panes">
	<section class="pane">
		<div class="pane-head">
			<hgroup>
				<h2>自分</h2>
				<p>頭が内省のたびに書き直す自己記述と、次の一歩・よそ者との対話・橋の候補。</p>
			</hgroup>
		</div>

		{#if !data.coreOk}
			<p class="note warn small">
				core.md が承認なしに変わっている。足は歩くのを止めている。サーバーで <code>ashi core --accept</code> を実行すると再開する。
			</p>
		{/if}

		<!-- 自己記述は本文に見出しがあるので、面の見出しは付けない -->
		<section class="panel">
			<div class="prose">{@html data.self}</div>
		</section>

		<section class="panel">
			<div class="panel-head">
				<h2>次の一歩</h2>
				<span class="tag accent">前回の内省で決めた</span>
			</div>
			{#if data.intentions.length}
				<ul class="rows">
					{#each data.intentions as i, k (k)}<li class="small">{i}</li>{/each}
				</ul>
			{:else}
				<p class="empty">まだ無い。</p>
			{/if}
		</section>

		<section class="panel">
			<div class="panel-head">
				<h2>よそ者との対話</h2>
				<span class="tag">{data.stranger.enabled ? `内省の前に ${data.stranger.model} と ${data.stranger.turns} 往復` : "止めている"}</span>
			</div>
			<p class="small muted">持ち主の地図を知らない別のモデルと話して、個性の種を外から持ち込む。相手の関心の分野は足がさいころで選ぶ。</p>
			{#if data.dialogues.length}
				<div class="stack" style="--gap: 0.5rem">
					{#each data.dialogues as d (d.at)}
						<details class="fold dialogue">
							<summary>
								<span class="tag accent">{d.field}</span>
								<span class="grow">{d.takeaway || "持ち帰りは無し"}</span>
								<span class="tiny muted nums">{when(d.at)}</span>
							</summary>
							<div class="stack" style="--gap: 0.5rem">
								{#each d.turns as t, k (k)}
									<p class="small turn {t.by}"><strong>{t.by === "ashi" ? "Ashi" : d.field}</strong>{t.text}</p>
								{/each}
								{#if d.added.length}
									<div>
										<p class="tiny muted">生まれた問い</p>
										<ul class="rows">
											{#each d.added as a, k (k)}<li class="small">{a}</li>{/each}
										</ul>
									</div>
								{/if}
							</div>
						</details>
					{/each}
				</div>
			{:else}
				<p class="empty">まだ話していない。次の内省の前に話す。</p>
			{/if}
		</section>

		<section class="panel">
			<div class="panel-head">
				<h2>橋の候補({data.bridges.length})</h2>
				<span class="tag">個性で思いついた、まだ推測の持ち帰り</span>
			</div>
			{#if data.bridges.length}
				<ul class="rows">
					{#each data.bridges.slice(0, BRIDGES_SHOWN) as b (b.id)}
						<li class="small bridge">
							<span class="tag info">{b.toTheme}</span>
							<span class="grow">{b.idea}</span>
							{#if b.fromNoteId}<a class="tiny" href="/notes/{b.fromNoteId}">元のノート</a>{/if}
						</li>
					{/each}
				</ul>
				{#if data.bridges.length > BRIDGES_SHOWN}
					<details class="more">
						<summary class="small">残り {data.bridges.length - BRIDGES_SHOWN} 件</summary>
						<ul class="rows">
							{#each data.bridges.slice(BRIDGES_SHOWN) as b (b.id)}
								<li class="small bridge">
									<span class="tag info">{b.toTheme}</span>
									<span class="grow">{b.idea}</span>
									{#if b.fromNoteId}<a class="tiny" href="/notes/{b.fromNoteId}">元のノート</a>{/if}
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			{:else}
				<p class="empty">まだ無い。</p>
			{/if}
		</section>

		<details class="fold">
			<summary>コア原則(人が書く・頭は変えられない)</summary>
			<div class="prose small">{@html data.core}</div>
		</details>
		<details class="fold">
			<summary>頭に渡している system の全文</summary>
			<pre class="small">{data.system}</pre>
		</details>
		<details class="fold">
			<summary>足の設定(ashi.json と ASHI_CONFIG を重ね、範囲に丸めた後)</summary>
			<pre class="small">{data.config}</pre>
		</details>

		<section class="panel danger">
			<div class="panel-head">
				<h2>学びをリセット</h2>
			</div>
			<p class="small">
				問い({data.counts.questions})・ノート({data.counts.notes})・日記・自己記述・橋の候補・よそ者との対話・次の一歩・歩数({data.counts.steps})を白紙に戻す。
				消さずに状態ディレクトリの <code>archive/</code> に移すので、あとから戻せる。コア原則・設定・持ち主の地図と渡した材料・改善案は残す。
			</p>
			{#if form?.resetMessage}<p class="note err small">{form.resetMessage}</p>{/if}
			{#if form?.archive}<p class="note ok small">リセットした。前の学びは {form.archive} にある。</p>{/if}
			{#if data.stepping}
				<p class="note warn small">いま歩いている途中です。休みに入ってから押してください。</p>
			{/if}
			<form method="POST" action="?/reset" use:enhance class="cluster">
				<input name="confirm" placeholder="確かめに「リセット」と入れる" aria-label="確かめ" class="confirm" autocomplete="off" />
				<button type="submit" class="outline small reset" disabled={data.stepping}>学びをリセットする</button>
			</form>
		</section>
	</section>

	<section class="pane">
		<!-- /owner の actions の結果も、この画面の form に届く -->
		<OwnerPane data={data.owner} form={form as { message?: string; added?: string } | null} />
	</section>
</div>

<style>
	.danger {
		border-color: var(--ui-err-bg);
	}
	.confirm {
		width: 16rem;
		margin: 0;
	}
	.reset {
		border-color: var(--ui-err);
		color: var(--ui-err);
	}
	pre {
		margin: 0;
		white-space: pre-wrap;
	}
	.bridge {
		align-items: flex-start;
	}
	.more {
		margin-top: 0.5rem;
	}
	.dialogue summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.turn {
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: var(--pico-border-radius);
		background: var(--ui-base-200);
	}
	.turn.ashi {
		background: var(--ui-accent-bg);
	}
	.turn strong {
		margin-right: 0.5rem;
	}
</style>
