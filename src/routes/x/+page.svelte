<script lang="ts">
import { enhance } from "$app/forms";
import Icon from "$lib/components/Icon.svelte";
import { usd, when } from "$lib/format";

let { data } = $props();
</script>

<svelte:head><title>X | Ashi</title></svelte:head>

<div class="stack" style="--gap: 1.25rem">
	<div class="head">
		<hgroup>
			<h1>X</h1>
			<p>
				Ashi 名義の X アカウント。投稿も返信も Ashi が自分で決める(知の探究に要るとき、この人と話を続けたいとき)。
				ほかの人との会話は Ashi の個性の材料になり、持ち主の地図には入らない。
			</p>
		</hgroup>
	</div>

	{#if !data.configured}
		<p class="note warn small">X のアプリが設定されていません(X_CLIENT_ID・X_CLIENT_SECRET)。</p>
	{/if}

	<div class="two">
		<section class="panel">
			<div class="panel-head">
				<h2>アカウント</h2>
				{#if data.account}
					<span class="tag {data.enabled ? 'ok' : 'warn'}">{data.enabled ? "動いている" : "止めている(x.enabled)"}</span>
				{/if}
			</div>
			{#if data.account}
				<p>
					<a href="https://x.com/{data.account.username}" target="_blank" rel="noopener noreferrer">@{data.account.username}</a>
					<span class="muted small"> ・ {when(data.account.connectedAt)} につないだ</span>
				</p>
				<p class="small muted">
					メンションを最後に読んだ: {data.account.lastMentionsAt ? when(data.account.lastMentionsAt) : "まだ"}
				</p>
				<div class="cluster">
					<a class="button outline small" href="/x/login" data-sveltekit-reload>つなぎ直す</a>
					<form method="POST" action="?/disconnect" use:enhance>
						<button type="submit" class="ghost small">切る</button>
					</form>
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
		<div class="panel-head"><h2>会話({data.conversations.length})</h2></div>
		{#if data.conversations.length}
			<div class="stack tight">
				{#each data.conversations as c (c.id)}
					<div class="conv">
						{#each c.messages.slice(-6) as m (m.id)}
							<div class="msg" class:mine={m.byAshi}>
								<a class="tiny muted" href="https://x.com/{m.username}/status/{m.id}" target="_blank" rel="noopener noreferrer">
									@{m.username} ・ {when(m.at)}
								</a>
								<p class="small">{m.text}</p>
							</div>
						{/each}
						{#if c.pending.length}<span class="tag info">返事を考える {c.pending.length} 件</span>{/if}
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty">まだ無い。</p>
		{/if}
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
				プロフィールの文の例: 「AI の Ashi です。自分で問いを選んで調べ、分かったことや聞いてみたいことを書いています。返信は自動です。運営 @5yuim」
			</p>
			<p class="small">
				<strong>自動化のラベル</strong>: X の「設定 → アカウント → アカウント情報 → 自動化」で、管理するアカウントに運営のアカウントを指定する。
			</p>
		</div>
	</details>
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
