<script lang="ts">
import { enhance } from "$app/forms";

let { data, form } = $props();

const EFFORT_LABEL: Record<string, string> = {
	low: "low(いちばん軽い)",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max(いちばん重い)",
};
/** トークン数を 36.6M・370K のように縮めて出す */
const tokens = (n: number) =>
	n >= 1e6
		? `${(n / 1e6).toFixed(1)}M`
		: n >= 1e3
			? `${Math.round(n / 1e3)}K`
			: String(n);
</script>

<svelte:head><title>設定 | Ashi</title></svelte:head>

<div class="page-container stack">
	<div class="head">
		<h1>設定</h1>
	</div>

	<section class="panel">
		<div class="panel-head"><h2>費用に効く設定</h2></div>
		<p class="small muted">
			頭はサブスク({data.cfg.head === "claude-code" ? "Claude Code" : "API キー"})で、手元の Claude Code と使用量の上限を分け合っている。
			トークンのほとんどは歩み 1 回の中の道具の往復で、往復のたびに文脈を読み直す。減らすなら、歩数か道具の往復の上限を下げるのがよく効く。
		</p>
		{#if form?.saved}<p class="note ok small">保存した。次の 1 歩から効く。</p>{/if}
		{#if form?.reset}<p class="note ok small">デプロイの設定に戻した。</p>{/if}
		<form method="POST" action="?/save" use:enhance class="stack">
			<label>
				1 日の歩数の上限
				<input type="number" name="maxStepsPerDay" min="1" max="1000" value={data.cfg.maxStepsPerDay} />
				<small>今日はここまで {data.today.steps} 歩。上限に来たら翌日まで歩かない。</small>
			</label>
			<label>
				1 歩の中で道具を使う往復の上限
				<input type="number" name="maxToolRounds" min="0" max="50" value={data.cfg.maxToolRounds} />
				<small>減らすと 1 歩の入力が減るが、調べる深さも浅くなる。</small>
			</label>
			<label>
				考える深さ(effort)
				<select name="effort">
					{#each Object.keys(EFFORT_LABEL) as e (e)}
						<option value={e} selected={data.cfg.effort === e}>{EFFORT_LABEL[e]}</option>
					{/each}
				</select>
				<small>下げると考える量(出力)が減る。Opus 5.5 の既定は medium。</small>
			</label>
			<label>
				頭のモデル
				<select name="model">
					{#each data.models as m (m)}
						<option value={m} selected={data.cfg.model === m}>{m}</option>
					{/each}
					{#if !data.models.includes(data.cfg.model)}
						<option value={data.cfg.model} selected>{data.cfg.model}</option>
					{/if}
				</select>
			</label>
			<label>
				<input type="checkbox" name="stranger" role="switch" checked={data.cfg.stranger} />
				よそ者と話す(内省のたびに {data.cfg.strangerModel} と 3 往復)
			</label>
			<label>
				<input type="checkbox" name="x" role="switch" checked={data.cfg.x} />
				X を動かす(投稿・返信・メンションと足跡の X を読む。X の API は従量課金)
			</label>
			<div class="cluster">
				<button type="submit" class="small">保存する</button>
			</div>
		</form>
		{#if data.overridden}
			<form method="POST" action="?/reset" use:enhance class="cluster">
				<span class="small muted grow">画面で変えた値が、デプロイの設定(ASHI_CONFIG)より優先されている。</span>
				<button type="submit" class="outline small">デプロイの設定に戻す</button>
			</form>
		{/if}
	</section>

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
</div>
