<script lang="ts">
import { enhance } from "$app/forms";

let { data, form } = $props();

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** トークン数を 36.6M・370K のように縮めて出す */
const tokens = (n: number) =>
	n >= 1e6
		? `${(n / 1e6).toFixed(1)}M`
		: n >= 1e3
			? `${Math.round(n / 1e3)}K`
			: String(n);
const subscription = $derived(data.cfg.head === "claude-code");
/** いまの値が選択肢に無ければ、それも選べるように足す */
const withCurrent = (list: string[], v: string) =>
	list.includes(v) ? list : [...list, v];
</script>

<svelte:head><title>設定 | Ashi</title></svelte:head>

<div class="page-container stack">
	<div class="head">
		<h1>設定</h1>
	</div>
	<p class="small muted">
		設定はここだけで変える(状態ディレクトリの ashi.json に保存する)。保存すると次の 1 歩から効き、再起動は要らない。
		環境変数に置くのは鍵と置き場所だけ。
	</p>
	{#if data.legacyEnv.length}
		<p class="note warn small">
			{data.legacyEnv.join("・")} が環境変数に残っている。中身は取り込み済みで、もう読んでいないので消してよい。
		</p>
	{/if}
	{#if form?.saved}<p class="note ok small">保存した。次の 1 歩から効く。</p>{/if}

	<form method="POST" action="?/save" use:enhance class="stack">
		<section class="panel">
			<div class="panel-head"><h2>頭</h2></div>
			<div class="grid">
				<label>
					繋ぎ方
					<select name="head">
						<option value="claude-code" selected={data.cfg.head === "claude-code"}>Claude Code(サブスク)</option>
						<option value="api" selected={data.cfg.head === "api"}>Claude API(API キー、従量課金)</option>
					</select>
				</label>
				<label>
					モデル
					<select name="model">
						{#each withCurrent(data.models, data.cfg.model) as m (m)}
							<option value={m} selected={data.cfg.model === m}>{m}</option>
						{/each}
					</select>
				</label>
				<label>
					考える深さ(effort)
					<select name="effort">
						{#each EFFORTS as e (e)}
							<option value={e} selected={data.cfg.effort === e}>{e}</option>
						{/each}
					</select>
				</label>
			</div>
			<small class="muted">
				{subscription
					? "サブスクは手元の Claude Code と使用量の上限を分け合う。effort を下げると考える量(出力)が減る。"
					: "API キーは使った分だけ課金される。下の 1 日の上限(ドル)で止まる。"}
			</small>
		</section>

		<section class="panel">
			<div class="panel-head"><h2>歩み</h2></div>
			<div class="grid">
				<label>
					1 日の歩数の上限
					<input type="number" name="maxStepsPerDay" min="1" max="1000" value={data.cfg.maxStepsPerDay} />
				</label>
				<label>
					1 歩の中で道具を使う往復の上限
					<input type="number" name="maxToolRounds" min="0" max="50" value={data.cfg.maxToolRounds} />
				</label>
				<label>
					確かめの問いをまとめて歩く本数
					<input type="number" name="verifyBatch" min="1" max="6" value={data.cfg.verifyBatch} />
				</label>
			</div>
			{#if !subscription}
				<div class="grid">
					<label>
						1 日の上限(ドル)
						<input type="number" name="budget.dailyUsd" min="0" step="0.5" value={data.cfg.budget.dailyUsd} />
					</label>
					<label>
						1 歩の上限(ドル)
						<input type="number" name="budget.stepUsd" min="0" step="0.1" value={data.cfg.budget.stepUsd} />
					</label>
				</div>
			{/if}
			<small class="muted">トークンのほとんどは 1 歩の中の道具の往復で、往復のたびに文脈を読み直す。減らすなら歩数か往復の上限がよく効く。</small>
		</section>

		<section class="panel">
			<div class="panel-head"><h2>よそ者との対話</h2></div>
			<input type="hidden" name="stranger.enabled:shown" value="1" />
			<label>
				<input type="checkbox" name="stranger.enabled" role="switch" checked={data.cfg.stranger.enabled} />
				内省のたびに、持ち主の地図を知らない別のモデルと話す
			</label>
			<div class="grid">
				<label>
					相手のモデル
					<select name="stranger.model">
						{#each withCurrent(data.models, data.cfg.stranger.model) as m (m)}
							<option value={m} selected={data.cfg.stranger.model === m}>{m}</option>
						{/each}
					</select>
				</label>
				<label>
					往復
					<input type="number" name="stranger.turns" min="1" max="6" value={data.cfg.stranger.turns} />
				</label>
			</div>
		</section>

		<section class="panel">
			<div class="panel-head"><h2>X</h2></div>
			<input type="hidden" name="x.enabled:shown" value="1" />
			<label>
				<input type="checkbox" name="x.enabled" role="switch" checked={data.cfg.x.enabled} />
				動かす(投稿・返信・メンションと、足跡の X を読む)
			</label>
			<div class="grid">
				<label>
					1 日の上限(ドル)
					<input type="number" name="x.dailyUsd" min="0" step="0.5" value={data.cfg.x.dailyUsd} />
				</label>
				<label>
					1 日の投稿
					<input type="number" name="x.maxPostsPerDay" min="0" value={data.cfg.x.maxPostsPerDay} />
				</label>
				<label>
					1 日の返信
					<input type="number" name="x.maxRepliesPerDay" min="0" value={data.cfg.x.maxRepliesPerDay} />
				</label>
				<label>
					メンションを見に行く間隔(分)
					<input type="number" name="x.mentionsEveryMinutes" min="1" value={data.cfg.x.mentionsEveryMinutes} />
				</label>
			</div>
			<small class="muted">X の API は従量課金。アカウントをつなぐのは X の画面で。前の投稿の削除は、ここを止めていてもアカウントがつながっていれば回る。</small>
		</section>

		<section class="panel">
			<div class="panel-head"><h2>持ち主の足跡</h2></div>
			<input type="hidden" name="feeds:shown" value="1" />
			<p class="small muted">いつ読むかは頭が決める。行き先を空にした行は保存しない。</p>
			<div class="feeds">
				<span class="lab">名前</span><span class="lab">種類</span><span class="lab">行き先</span><span class="lab">見出し</span><span class="lab">消す</span>
				{#each [...data.cfg.feeds, { id: "", kind: "rss", target: "", title: "" }] as f, i (i)}
					<input name="feed.id" value={f.id} placeholder="blog" aria-label="名前" />
					<select name="feed.kind" aria-label="種類">
						{#each data.feedKinds as k (k)}
							<option value={k} selected={f.kind === k}>{k}</option>
						{/each}
					</select>
					<input name="feed.target" value={f.target} placeholder={f.id ? "" : "RSS の URL か、ユーザー名"} aria-label="行き先" />
					<input name="feed.title" value={f.title ?? ""} aria-label="見出し" />
					{#if f.id}
						<input type="checkbox" name="feed.remove" value={String(i)} aria-label="消す" />
					{:else}
						<span></span>
					{/if}
				{/each}
			</div>
		</section>

		<div class="cluster">
			<button type="submit">保存する</button>
		</div>
	</form>

	<details class="fold">
		<summary>全部の項目(JSON)</summary>
		<p class="small muted">上の欄に無い項目(休む時間・テーマの休ませ方・ニュースなど)もここで変えられる。範囲の外の値は丸める。</p>
		{#if form && "jsonError" in form}<p class="note err small">{form.jsonError}</p>{/if}
		<form method="POST" action="?/saveJson" use:enhance class="stack">
			<textarea name="json" rows="24" class="mono" spellcheck="false">{form && "json" in form ? form.json : data.json}</textarea>
			<div class="cluster"><button type="submit" class="outline small">JSON で保存する</button></div>
		</form>
	</details>

	<section class="panel">
		<div class="panel-head"><h2>トークンの使用量</h2></div>
		<ul class="rows">
			<li>
				<span class="grow">今日</span>
				<span class="nums small">{data.today.steps} 歩 ・ 入力 {tokens(data.today.inputTokens)} ・ 出力 {tokens(data.today.outputTokens)}</span>
			</li>
			{#each data.history as h (h.day)}
				<li>
					<span class="grow">{h.day}</span>
					<span class="nums small">{h.steps ?? 0} 歩 ・ 入力 {tokens(h.inputTokens)} ・ 出力 {tokens(h.outputTokens)}</span>
				</li>
			{/each}
		</ul>
		<p class="tiny muted">入力はキャッシュの読み書きを含む。日ごとの記録は 2026-10-03 から。</p>
	</section>

	<section class="panel">
		<div class="panel-head"><h2>鍵</h2></div>
		<p class="small muted">鍵は環境変数で渡す(画面には出さない)。入っているかだけを見せる。</p>
		<ul class="rows">
			{#each Object.entries(data.secrets) as [k, ok] (k)}
				<li>
					<code class="grow">{k}</code>
					<span class="tag {ok ? 'ok' : ''}">{ok ? "入っている" : "無い"}</span>
				</li>
			{/each}
		</ul>
	</section>
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0 1rem;
	}
	.feeds {
		display: grid;
		grid-template-columns: 1fr 7rem 2fr 1fr auto;
		gap: 0.25rem 0.5rem;
		align-items: center;
		overflow-x: auto;
	}
	.feeds :global(input),
	.feeds :global(select) {
		margin: 0;
	}
	.mono {
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
	}
	@media (max-width: 640px) {
		.feeds {
			grid-template-columns: 1fr 1fr;
		}
		.feeds .lab {
			display: none;
		}
	}
</style>
