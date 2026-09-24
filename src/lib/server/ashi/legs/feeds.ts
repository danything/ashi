import type { Config, Feed } from "../config.ts";
import { newId, type Store } from "../state.ts";
import {
	feedBlockage,
	raiseBlocker,
	resolveBlockers,
	webhookNotify,
} from "./blockers.ts";
import { type GetDeps, htmlToText, safeGet } from "./tools.ts";

/**
 * 持ち主の足跡(ブログ・GitHub・X)を読みに行く。どれを・いつ読むかは頭が決め(歩みの答えの crawl)、
 * 足は ashi.json に人が書いた先だけを、間隔の下限を守って GET で読む。読んだものは持ち主の材料(sources)になる。
 */

export interface FeedItem {
	/** 重ねて取り込まないための鍵(記事の URL・イベントの id など) */
	key: string;
	title: string;
	url?: string;
	body: string;
	at?: string;
}

export interface FeedState {
	lastCrawledAt?: string;
	/** 前回見つけた新しいものの数 */
	lastNew: number;
	lastError?: string;
	seen: string[];
}

const SEEN_MAX = 1000;
/** 1 回で取り込む数の上限(初回に何百件も材料にしない) */
const ITEMS_MAX = 20;

// ---- 読む

const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
const tag = (xml: string, name: string) => {
	const m = xml.match(
		new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
	);
	return m?.[1] ? unCdata(m[1]).trim() : undefined;
};

/** RSS 2.0 と Atom の記事。雑でよい(読むのは頭) */
export function parseFeed(xml: string): FeedItem[] {
	const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
	return blocks.map((b) => {
		const href = b.match(/<link[^>]*href="([^"]+)"/i)?.[1];
		const url = href ?? tag(b, "link");
		const body =
			tag(b, "content:encoded") ??
			tag(b, "content") ??
			tag(b, "description") ??
			tag(b, "summary") ??
			"";
		const title = htmlToText(tag(b, "title") ?? "無題");
		return {
			key: tag(b, "guid") ?? tag(b, "id") ?? url ?? title,
			title,
			url,
			body: htmlToText(body).slice(0, 8000),
			at: tag(b, "pubDate") ?? tag(b, "updated") ?? tag(b, "published"),
		};
	});
}

interface GhEvent {
	id: string;
	type: string;
	created_at: string;
	repo: { name: string };
	payload: {
		action?: string;
		ref?: string;
		ref_type?: string;
		commits?: { message: string }[];
		pull_request?: { title: string; body?: string | null };
		issue?: { title: string; body?: string | null };
		comment?: { body?: string };
		release?: { name?: string; tag_name?: string };
	};
}

/** GitHub の公開イベントを 1 行ずつの文に。スターも興味の手がかりになる */
export function describeGithubEvent(e: GhEvent): string | undefined {
	const r = e.repo.name;
	const p = e.payload;
	switch (e.type) {
		case "PushEvent":
			return `${r} に push: ${(p.commits ?? []).map((c) => c.message.split("\n")[0]).join(" / ")}`;
		case "PullRequestEvent":
			return `${r} の PR を ${p.action}: ${p.pull_request?.title}\n${(p.pull_request?.body ?? "").slice(0, 1500)}`;
		case "IssuesEvent":
			return `${r} の issue を ${p.action}: ${p.issue?.title}\n${(p.issue?.body ?? "").slice(0, 1500)}`;
		case "IssueCommentEvent":
			return `${r} の「${p.issue?.title}」にコメント: ${(p.comment?.body ?? "").slice(0, 1000)}`;
		case "WatchEvent":
			return `${r} にスターを付けた`;
		case "ForkEvent":
			return `${r} を fork した`;
		case "CreateEvent":
			return p.ref_type === "repository" ? `${r} を作った` : undefined;
		case "ReleaseEvent":
			return `${r} を ${p.release?.name || p.release?.tag_name} としてリリース`;
		default:
			return undefined;
	}
}

type Env = Record<string, string | undefined>;

export async function crawlFeed(
	feed: Feed,
	cfg: Pick<Config, "fetch">,
	deps: GetDeps = {},
	env: Env = process.env,
): Promise<FeedItem[]> {
	switch (feed.kind) {
		case "rss": {
			const r = await safeGet(feed.target, cfg, deps);
			if (r.status !== 200) throw new Error(`${r.status} ${r.url}`);
			return parseFeed(r.body);
		}
		case "github": {
			const headers: Record<string, string> = {
				accept: "application/vnd.github+json",
			};
			if (env.GITHUB_TOKEN)
				headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
			const r = await safeGet(
				`https://api.github.com/users/${encodeURIComponent(feed.target)}/events/public?per_page=100`,
				cfg,
				deps,
				headers,
			);
			if (r.status !== 200) throw new Error(`GitHub ${r.status}`);
			return (JSON.parse(r.body) as GhEvent[]).flatMap((e) => {
				const text = describeGithubEvent(e);
				return text
					? [
							{
								key: `gh:${e.id}`,
								title: text.split("\n")[0] ?? "",
								body: text,
								at: e.created_at,
							},
						]
					: [];
			});
		}
		case "x": {
			// X は公式 API しか読まない(ページの取り込みは規約に反する)。読むには有料の API の鍵が要る
			const token = env.X_BEARER_TOKEN;
			if (!token) throw new Error("X_BEARER_TOKEN が無い");
			const headers = { authorization: `Bearer ${token}` };
			const u = await safeGet(
				`https://api.x.com/2/users/by/username/${encodeURIComponent(feed.target)}`,
				cfg,
				deps,
				headers,
			);
			if (u.status !== 200) throw new Error(`X ${u.status}`);
			const id = (JSON.parse(u.body) as { data?: { id?: string } }).data?.id;
			if (!id) throw new Error("X のユーザーが見つからない");
			const t = await safeGet(
				`https://api.x.com/2/users/${id}/tweets?max_results=50&tweet.fields=created_at`,
				cfg,
				deps,
				headers,
			);
			if (t.status !== 200) throw new Error(`X ${t.status}`);
			const tweets =
				(
					JSON.parse(t.body) as {
						data?: { id: string; text: string; created_at?: string }[];
					}
				).data ?? [];
			return tweets.map((tw) => ({
				key: `x:${tw.id}`,
				title: tw.text.slice(0, 60),
				url: `https://x.com/${feed.target}/status/${tw.id}`,
				body: tw.text,
				at: tw.created_at,
			}));
		}
	}
}

// ---- 取り込む

/** 前回から間を空けたか。短い間隔で何度も叩かない(足のガードレール) */
export function crawlable(
	state: FeedState | undefined,
	cfg: Pick<Config, "feedMinHours">,
	now: Date,
): boolean {
	if (!state?.lastCrawledAt) return true;
	return (
		now.getTime() - new Date(state.lastCrawledAt).getTime() >=
		cfg.feedMinHours * 3600_000
	);
}

/**
 * 頭が読みたいと言ったフィードを読み、新しいものを材料にする。
 * 知らない id・間隔の下限に届かないもの・1 歩の上限を超えるものは足が落とす
 */
export async function crawlRequested(
	store: Store,
	requested: string[],
	now: Date,
	deps: GetDeps = {},
	env: Env = process.env,
	notify = webhookNotify,
): Promise<{ id: string; added: number; error?: string }[]> {
	const cfg = store.config();
	const states = store.feedStates();
	const feeds = [...new Set(requested)]
		.map((id) => cfg.feeds.find((f) => f.id === id))
		.filter(
			(f): f is Feed => Boolean(f) && crawlable(states[f?.id ?? ""], cfg, now),
		)
		.slice(0, 3);
	const out: { id: string; added: number; error?: string }[] = [];
	for (const feed of feeds) {
		const prev = states[feed.id] ?? { lastNew: 0, seen: [] };
		try {
			const items = await crawlFeed(feed, cfg, deps, env);
			const seen = new Set(prev.seen);
			const fresh = items.filter((i) => !seen.has(i.key)).slice(0, ITEMS_MAX);
			ingest(store, feed, fresh, now);
			const keys = [...prev.seen, ...items.map((i) => i.key)];
			store.saveFeedState(feed.id, {
				lastCrawledAt: now.toISOString(),
				lastNew: fresh.length,
				seen: [...new Set(keys)].slice(-SEEN_MAX),
			});
			out.push({ id: feed.id, added: fresh.length });
			resolveBlockers(store, `feed:${feed.id}`, now);
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			// 失敗しても間隔は空ける(壊れた先を毎歩叩かない)
			store.saveFeedState(feed.id, {
				...prev,
				lastCrawledAt: now.toISOString(),
				lastNew: 0,
				lastError: error,
			});
			out.push({ id: feed.id, added: 0, error });
			// 人が鍵を足すか設定を直すまで進めないので、知らせる
			await raiseBlocker(store, "feed", feedBlockage(feed, error), now, notify);
		}
	}
	if (out.length) store.log("crawled", { results: out });
	return out;
}

/** ブログは 1 記事 1 件、GitHub と X は 1 回の巡回をまとめて 1 件の材料にする */
function ingest(store: Store, feed: Feed, items: FeedItem[], now: Date): void {
	if (items.length === 0) return;
	const base = {
		kind: "feed" as const,
		feedId: feed.id,
		createdAt: now.toISOString(),
	};
	if (feed.kind === "rss") {
		for (const i of items) {
			store.addSource(
				{ ...base, id: newId(), title: i.title, url: i.url },
				`# ${i.title}\n\n${i.at ?? ""}\n\n${i.body}`,
			);
		}
		return;
	}
	const label = feed.kind === "github" ? "GitHub" : "X";
	const body = items
		.map((i) => `- ${i.at ?? ""} ${i.body.replace(/\n+/g, " ")}`)
		.join("\n");
	store.addSource(
		{ ...base, id: newId(), title: `${label} の動き(${items.length} 件)` },
		body,
	);
}

/** 頭に見せるフィードの様子 */
export function feedStatus(store: Store, now: Date): string {
	const cfg = store.config();
	if (cfg.feeds.length === 0) return "(登録されていない)";
	const states = store.feedStates();
	return cfg.feeds
		.map((f) => {
			const s = states[f.id];
			const last = s?.lastCrawledAt
				? `${Math.round((now.getTime() - new Date(s.lastCrawledAt).getTime()) / 3600_000)} 時間前に見た、そのとき新しいもの ${s.lastNew} 件${s.lastError ? `、失敗: ${s.lastError}` : ""}`
				: "まだ見ていない";
			const ok = crawlable(s, cfg, now)
				? ""
				: `(${cfg.feedMinHours} 時間空くまで見られない)`;
			return `- ${f.id} [${f.kind}] ${f.title ?? f.target}: ${last}${ok}`;
		})
		.join("\n");
}
