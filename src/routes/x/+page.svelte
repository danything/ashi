<script lang="ts">
import { enhance } from "$app/forms";
import Icon from "$lib/components/Icon.svelte";
import { usd, when } from "$lib/format";

let { data, form } = $props();
let posting = $state(false);
</script>

<svelte:head><title>X | Ashi</title></svelte:head>

<div class="stack" style="--gap: 0.75rem">

	{#if !data.configured}
		<p class="note warn small">X のアプリが設定されていません(X_CLIENT_ID・X_CLIENT_SECRET)。</p>
	{/if}

	<!-- 左に設定と今日の数、右に会話。会話は枠の中でスクロールする -->
	<div class="panes">
	<section class="pane">
	<div class="pane-head">
		<span class="pane-name">設定</span>
		<span class="hint" title="投稿も返信も Ashi が自分で決める。ほかの人との会話は個性の材料になり、持ち主の地図には入らない">投稿も返信も Ashi が自分で決める。ほかの人との会話は個性の材料になる</span>
	</div>
	<div class="two">
		<section class="panel">
			<div class="panel-head">
				<h2>アカウント</h2>
				{#if data.account}
					<span class="tag {data.enabled ? 'ok' : 'warn'}">{data.enabled ? "動いている" : "止めている(x.enabled)"}</span>
				{/if}
			</div>
			{#if data.account}
				<div class="stack account">
					<div>
						<a href="https://x.com/{data.account.username}" target="_blank" rel="noopener noreferrer"><strong>@{data.account.username}</strong></a>
						<p class="small muted">
							{when(data.account.connectedAt)} につないだ ・ メンションを最後に読んだ:
							{data.account.lastMentionsAt ? when(data.account.lastMentionsAt) : "まだ"}
						</p>
					</div>
					<div class="cluster actions">
						<form
							method="POST"
							action="?/postNow"
							use:enhance={() => {
								posting = true;
								return async ({ update }) => {
									await update();
									posting = false;
								};
							}}
						>
							<button type="submit" class="small" aria-busy={posting} disabled={posting}>いま 1 件投稿させる</button>
						</form>
						<a class="button outline small" href="/x/login" data-sveltekit-reload>つなぎ直す</a>
						<form method="POST" action="?/disconnect" use:enhance>
							<button type="submit" class="ghost small">切る</button>
						</form>
					</div>
					{#if posting}<p class="tiny muted">Ashi が書いている(数十秒かかる)</p>{/if}
					{#if form?.message}<p class="note err small">{form.message}</p>{/if}
					{#if form && "posted" in form}
						<p class="note ok small">
							投稿した: {form.posted}
							<a href="https://x.com/{data.account.username}/status/{form.id}" target="_blank" rel="noopener noreferrer">見る</a>
						</p>
					{/if}
				</div>
			{:else}
				<p class="small">
					X に <strong>Ashi のアカウント</strong>でログインした状態で押す(持ち主のアカウントでつながないこと)。
					X の開発者ポータルで、アプリのコールバック URL に <code>https://as.doany.io/x/callback</code> を足しておく。
				</p>
				<a class="button small" href="/x/login" data-sveltekit-reload><Icon name="link" size={1} />Ashi のアカウントをつなぐ</a>
			{/if}
		</section>

		<section class="panel">
			<div class="panel-head"><h2>今日</h2></div>
			<div class="stats mini">
				<div class="stat"><span class="label">投稿</span><span class="value">{data.today.posts}<span class="unit"> / {data.limits.maxPostsPerDay}</span></span></div>
				<div class="stat"><span class="label">返信</span><span class="value">{data.today.replies}<span class="unit"> / {data.limits.maxRepliesPerDay}</span></span></div>
				<div class="stat"><span class="label">X の額</span><span class="value">{usd(data.today.usd)}<span class="unit"> / {usd(data.limits.dailyUsd)}</span></span></div>
			</div>
			<p class="tiny muted">X の API は従量課金(読み 1 件 $0.005、投稿 1 件 ${data.writeUsd})。上限は ASHI_CONFIG の x で変えられる。</p>
		</section>
	</div>
	<section class="panel">
		<div class="panel-head"><h2>前の用途の投稿を消す</h2></div>
		{#if data.cleanup}
			<div class="cluster">
				<span class="nums">{data.cleanup.deleted} / {data.cleanup.total} 件消した</span>
				<span class="muted small">残り {data.cleanup.left} 件{data.cleanup.failed ? `、消せなかった ${data.cleanup.failed} 件` : ""}</span>
				<span class="grow"></span>
				{#if data.cleanup.left > 0}
					<form method="POST" action="?/cleanupStop" use:enhance><button type="submit" class="ghost small">止める</button></form>
				{/if}
			</div>
			<div class="meter"><span style:width="{Math.round((data.cleanup.deleted / Math.max(1, data.cleanup.total)) * 100)}%"></span></div>
			<p class="tiny muted">
				15 分に 50 件ずつ(X の上限)。{data.cleanup.doneAt ? `終わるのは ${when(data.cleanup.doneAt)} ごろ。` : "終わった。"}
				{data.cleanup.lastRunAt ? `最後に回したのは ${when(data.cleanup.lastRunAt)}。` : ""}
			</p>
			{#if data.cleanup.lastError}<p class="note warn tiny">{data.cleanup.lastError}</p>{/if}
		{:else}
			<p class="small">
				X のアーカイブ(設定 → アカウント → データのアーカイブをダウンロード)の zip の中の <code>data/tweets.js</code> を渡すと、
				Ashi をつなぐより前の投稿を 15 分に 50 件ずつ消す。Ashi の投稿は消さない。
			</p>
			{#if form && "cleanupMessage" in form}<p class="note err small">{form.cleanupMessage}</p>{/if}
			<form method="POST" action="?/cleanup" enctype="multipart/form-data" use:enhance class="cluster">
				<input type="file" name="archive" accept=".js" required class="file" />
				<button type="submit" class="outline small">消し始める</button>
			</form>
		{/if}
		{#if form && "cleanupStarted" in form}<p class="note ok small">{form.cleanupStarted} 件を消し始めた。</p>{/if}
	</section>
	<details class="fold">
		<summary>アカウントの見た目(アイコン・ヘッダー・プロフィール)</summary>
		<div class="stack">
			<div class="cluster">
				<a href="/x/icon.png" download><img src="/x/icon.png" alt="アイコン" class="icon" /></a>
				<a href="/x/header.png" download class="grow"><img src="/x/header.png" alt="ヘッダー" class="header" /></a>
			</div>
			<p class="small">押すと保存できる。X のプロフィールの編集から設定する。</p>
			<p class="small">
				名前の例: 「あし🌱AI」。プロフィールの文の例: 「葦の芽に足が生えた AI、あしです。毎日なにか 1 つ調べて歩いてます🔍 知ってること・気になること、気軽にリプしてね! 返信も私(AI)が自分で書いてます。運営 @5yuim」
			</p>
			<p class="small">
				<strong>自動化のラベル</strong>: X の「設定 → アカウント → アカウント情報 → 自動化」で、管理するアカウントに運営のアカウントを指定する。
			</p>
		</div>
	</details>
	</section>
	<section class="pane">
	<div class="pane-head">
		<span class="pane-name">会話</span>
		<span class="count">{data.conversations.length} 件</span>
	</div>
	<section class="panel">
		{#if data.conversations.length}
			<div class="stack tight">
				{#each data.conversations as c (c.id)}
					<div class="conv">
						{#each c.messages.slice(-6) as m (m.id)}
							{#if m.unrelated}
								<details class="unrelated tiny muted">
									<summary>@{m.username} のリンクだけの返信(たぶん無関係)</summary>
									<p>{m.text}</p>
								</details>
							{:else}
								<div class="msg" class:mine={m.byAshi}>
									<a class="tiny muted" href="https://x.com/{m.username}/status/{m.id}" target="_blank" rel="noopener noreferrer">
										@{m.username} ・ {when(m.at)}
									</a>
									<p class="small">{m.text}</p>
								</div>
							{/if}
						{/each}
						{#if c.pending.length}<span class="tag info">返事を考える {c.pending.length} 件</span>{/if}
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty">まだ無い。</p>
		{/if}
	</section>
	</section>
	</div>
</div>

<style>
	.stats.mini {
		grid-template-columns: repeat(3, 1fr);
	}
	.stats.mini .stat {
		padding: 0;
	}
	.unit {
		color: var(--ui-muted);
		font-size: 0.8rem;
	}
	.conv {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		border-left: 3px solid var(--ui-base-300);
		padding: 0.25rem 0 0.25rem 0.75rem;
	}
	.unrelated p {
		margin: 0.25rem 0 0;
		overflow-wrap: anywhere;
	}
	.msg p {
		margin: 0;
		white-space: pre-wrap;
	}
	.msg.mine {
		border-radius: 0.5rem;
		background: var(--ui-accent-bg);
		padding: 0.35rem 0.6rem;
	}
	form {
		margin: 0;
	}
	.account {
		--gap: 0.9rem;
	}
	.account p {
		margin-top: 0.15rem;
	}
	.actions {
		--gap: 0.5rem;
	}
	.file {
		width: auto;
		margin: 0;
	}
	.icon {
		width: 6rem;
		height: 6rem;
		border-radius: 999px;
	}
	.header {
		width: 100%;
		max-width: 30rem;
		border-radius: 0.5rem;
	}
</style>
