<script lang="ts">
import { enhance } from "$app/forms";
import Icon from "$lib/components/Icon.svelte";
import BlockedPane from "$lib/components/panes/BlockedPane.svelte";
import { when } from "$lib/format";

let { data } = $props();
</script>

<svelte:head><title>直すこと | Ashi</title></svelte:head>

<h1 class="sr-only">直すこと</h1>
<div class="panes">
<section class="pane">
	<div class="pane-head">
		<span class="pane-name">改善案</span>
		<span class="count">{data.open.length} 件</span>
		<span class="hint" title="Ashi が内省で、自分の仕組みについて出した注文。直すかは持ち主が決める">Ashi が内省で出した、自分の仕組みへの注文。直すかは持ち主が決める</span>
	</div>

	{#each data.open as p (p.id)}
		<article class="panel item">
			<div class="cluster">
				<strong class="grow">{p.title}</strong>
				{#if p.count > 1}<span class="tag warn">{p.count} 回出た</span>{/if}
				<span class="muted tiny nums">{when(p.lastAt)}</span>
			</div>
			<div class="two">
				<div>
					<h3 class="lab">困ったこと</h3>
					<div class="prose small">{@html p.whyHtml}</div>
				</div>
				<div>
					<h3 class="lab">こうすればよさそう</h3>
					<div class="prose small">{@html p.ideaHtml}</div>
				</div>
			</div>
			<div class="cluster">
				<a class="button small" href={p.newIssueUrl} target="_blank" rel="noopener noreferrer">
					<Icon name="link" size={1} />issue にする
				</a>
				<form method="POST" action="?/filed" use:enhance class="cluster">
					<input type="hidden" name="id" value={p.id} />
					<input name="issueUrl" type="url" placeholder="作った issue の URL(任意)" aria-label="issue の URL" class="url" />
					<button type="submit" class="outline small"><Icon name="check" size={1} />issue にした</button>
				</form>
				<span class="grow"></span>
				<form method="POST" action="?/done" use:enhance>
					<input type="hidden" name="id" value={p.id} />
					<button type="submit" class="ghost small">直した</button>
				</form>
				<form method="POST" action="?/dismiss" use:enhance>
					<input type="hidden" name="id" value={p.id} />
					<button type="submit" class="ghost small">見送る</button>
				</form>
			</div>
		</article>
	{:else}
		<div class="panel"><p class="empty">いま開いている改善案は無い。</p></div>
	{/each}

	{#if data.done.length}
		<details class="fold">
			<summary>直した・issue にした・見送った({data.done.length})</summary>
			<ul class="rows">
				{#each data.done as p (p.id)}
					<li>
						<span class="tag {p.status === 'dismissed' ? '' : 'ok'}">{({ filed: "issue にした", done: "直した", dismissed: "見送った" } as Record<string, string>)[p.status] ?? p.status}</span>
						<span class="grow small">
							{#if p.issueUrl}<a href={p.issueUrl} target="_blank" rel="noopener noreferrer">{p.title}</a>{:else}{p.title}{/if}
						</span>
						<form method="POST" action="?/reopen" use:enhance>
							<input type="hidden" name="id" value={p.id} />
							<button type="submit" class="ghost mini">戻す</button>
						</form>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>

<section class="pane">
	<BlockedPane data={data.blocked} />
</section>
</div>

<style>
	.item {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.lab {
		margin-bottom: 0.25rem;
		color: var(--ui-muted);
		font-size: 0.78rem;
	}
	form {
		margin: 0;
	}
	.url {
		width: 16rem;
		margin: 0;
		padding-block: 0.35rem;
		font-size: 0.85rem;
	}
</style>
