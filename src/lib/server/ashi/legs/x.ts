import { createHash, randomBytes } from "node:crypto";
import type { Config } from "../config.ts";
import type { Blockage } from "../head/head.ts";
import {
	localDay,
	type Store,
	type XAccount,
	type XConversation,
	type XMessage,
} from "../state.ts";

/**
 * Ashi の X アカウント(投稿・返信・メンションを読む)。作りは xool(x.doany.io)に倣った。
 *
 * - 認証は OAuth 2.0 + PKCE(S256)。スコープは tweet.read tweet.write users.read offline.access
 * - トークンは状態ディレクトリの x.json(0600)。頭にも画面にも出さない。401 ならリフレッシュして 1 回だけやり直す
 * - X の API は従量課金(読み 1 件 0.005・投稿 1 件 0.015 ドル、URL 入りの投稿は 0.2 ドル)。呼ぶたびに今日の予算の xUsd に付け、
 *   設定の x.dailyUsd・投稿と返信の数の上限で止める(guard は canPost / canReply)
 */

const API = "https://api.x.com/2";
export const READ_USD = 0.005;
export const WRITE_USD = 0.015;
/** URL を含む投稿は 1 件 0.2 ドル(普通の投稿の 13 倍、2026-09 の料金表) */
export const WRITE_URL_USD = 0.2;
export const writeUsd = (text: string) =>
	/https?:\/\//i.test(text) ? WRITE_URL_USD : WRITE_USD;
export const X_SCOPES = "tweet.read tweet.write users.read offline.access";

type Env = Record<string, string | undefined>;

export const xConfigured = (env: Env = process.env) =>
	Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET);

const basic = (env: Env) =>
	`Basic ${Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString("base64")}`;

export interface XPending {
	state: string;
	verifier: string;
}

export function xAuthorizeUrl(
	redirectUri: string,
	env: Env = process.env,
): { url: string; pending: XPending } {
	const pending = {
		state: randomBytes(24).toString("base64url"),
		verifier: randomBytes(48).toString("base64url"),
	};
	const params = new URLSearchParams({
		response_type: "code",
		client_id: env.X_CLIENT_ID ?? "",
		redirect_uri: redirectUri,
		scope: X_SCOPES,
		state: pending.state,
		code_challenge: createHash("sha256")
			.update(pending.verifier)
			.digest("base64url"),
		code_challenge_method: "S256",
	});
	return { url: `https://x.com/i/oauth2/authorize?${params}`, pending };
}

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	error?: string;
	error_description?: string;
}

async function token(
	body: Record<string, string>,
	env: Env,
	doFetch: typeof fetch,
): Promise<TokenResponse> {
	const res = await doFetch(`${API}/oauth2/token`, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			authorization: basic(env),
		},
		body: new URLSearchParams(body),
		signal: AbortSignal.timeout(15_000),
	});
	return (await res.json().catch(() => ({}))) as TokenResponse;
}

/** 認可コードをトークンに換え、誰のアカウントかを確かめて保存する */
export async function xFinishLogin(
	store: Store,
	code: string,
	redirectUri: string,
	pending: XPending,
	now: Date,
	env: Env = process.env,
	doFetch: typeof fetch = fetch,
): Promise<XAccount> {
	const t = await token(
		{
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			code_verifier: pending.verifier,
		},
		env,
		doFetch,
	);
	if (!t.access_token || !t.refresh_token) {
		throw new Error(
			`X のトークンに換えられない: ${t.error_description ?? t.error ?? "理由なし"}`,
		);
	}
	const me = await doFetch(`${API}/users/me`, {
		headers: { authorization: `Bearer ${t.access_token}` },
		signal: AbortSignal.timeout(15_000),
	});
	const body = (await me.json().catch(() => ({}))) as {
		data?: { id: string; username: string };
	};
	if (!body.data)
		throw new Error(`X のアカウントを確かめられない(${me.status})`);
	chargeX(store, now, READ_USD);
	const account: XAccount = {
		userId: body.data.id,
		username: body.data.username,
		accessToken: t.access_token,
		refreshToken: t.refresh_token,
		expiresAt: new Date(
			now.getTime() + (t.expires_in ?? 7200) * 1000,
		).toISOString(),
		connectedAt: now.toISOString(),
	};
	store.saveXAccount(account);
	return account;
}

/** 今日の予算に X の分を付ける */
export function chargeX(
	store: Store,
	now: Date,
	usd: number,
	kind?: "post" | "reply",
): void {
	const day = localDay(now);
	const b = store.budget(day);
	store.saveBudget({
		...b,
		xUsd: (b.xUsd ?? 0) + usd,
		xPosts: (b.xPosts ?? 0) + (kind === "post" ? 1 : 0),
		xReplies: (b.xReplies ?? 0) + (kind === "reply" ? 1 : 0),
	});
}

/** いま X を使ってよいか(つながっていて、有効で、今日の額が残っている) */
export function xReady(
	store: Store,
	cfg: Pick<Config, "x">,
	now: Date,
): boolean {
	if (!cfg.x.enabled || !store.xAccount()) return false;
	return (store.budget(localDay(now)).xUsd ?? 0) + WRITE_USD <= cfg.x.dailyUsd;
}

export function canPost(
	store: Store,
	cfg: Pick<Config, "x">,
	now: Date,
): boolean {
	return (
		xReady(store, cfg, now) &&
		(store.budget(localDay(now)).xPosts ?? 0) < cfg.x.maxPostsPerDay
	);
}

export function canReply(
	store: Store,
	cfg: Pick<Config, "x">,
	now: Date,
): boolean {
	return (
		xReady(store, cfg, now) &&
		(store.budget(localDay(now)).xReplies ?? 0) < cfg.x.maxRepliesPerDay
	);
}

/**
 * X の文字数(重み付き)。CJK などは 2、ラテン文字などは 1、URL は 23。上限は 280
 * (日本語だけなら 140 字)
 */
export function xLength(text: string): number {
	let n = 0;
	const withoutUrls = text.replace(/https?:\/\/\S+/g, () => {
		n += 23;
		return "";
	});
	for (const ch of withoutUrls) {
		const c = ch.codePointAt(0) ?? 0;
		const light =
			(c >= 0x0000 && c <= 0x10ff) ||
			(c >= 0x2000 && c <= 0x200d) ||
			(c >= 0x2010 && c <= 0x201f) ||
			(c >= 0x2032 && c <= 0x2037);
		n += light ? 1 : 2;
	}
	return n;
}

export class XError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

/** トークン付きで X を呼ぶ。401 ならリフレッシュして 1 回だけやり直す */
export async function call<T>(
	store: Store,
	method: "GET" | "POST" | "DELETE",
	path: string,
	body: unknown,
	now: Date,
	env: Env,
	doFetch: typeof fetch,
): Promise<T> {
	let account = store.xAccount();
	if (!account) throw new XError("X のアカウントがつながっていない", 0);
	const send = (tok: string) =>
		doFetch(`${API}/${path}`, {
			method,
			headers: {
				authorization: `Bearer ${tok}`,
				...(body ? { "content-type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(15_000),
		});
	// 期限が近ければ先にリフレッシュする
	const expiring =
		new Date(account.expiresAt).getTime() - now.getTime() < 60_000;
	let res = expiring ? undefined : await send(account.accessToken);
	if (!res || res.status === 401) {
		const t = await token(
			{
				grant_type: "refresh_token",
				refresh_token: account.refreshToken,
				client_id: env.X_CLIENT_ID ?? "",
			},
			env,
			doFetch,
		);
		if (!t.access_token) {
			throw new XError(
				`X のトークンを更新できない。/x からつなぎ直す(${t.error ?? "理由なし"})`,
				401,
			);
		}
		account = {
			...account,
			accessToken: t.access_token,
			refreshToken: t.refresh_token ?? account.refreshToken,
			expiresAt: new Date(
				now.getTime() + (t.expires_in ?? 7200) * 1000,
			).toISOString(),
		};
		store.saveXAccount(account);
		res = await send(account.accessToken);
	}
	const text = await res.text();
	if (!res.ok)
		throw new XError(`X ${res.status}: ${text.slice(0, 300)}`, res.status);
	return (text ? JSON.parse(text) : {}) as T;
}

interface Tweet {
	id: string;
	text: string;
	author_id?: string;
	conversation_id?: string;
	created_at?: string;
	referenced_tweets?: { type: string; id: string }[];
}

/**
 * 新しいメンションを読み、会話に足す。間隔の下限と額の上限は足が見る。
 * 返すのは新しく届いた件数
 */
export async function fetchMentions(
	store: Store,
	cfg: Pick<Config, "x">,
	now: Date,
	env: Env = process.env,
	doFetch: typeof fetch = fetch,
): Promise<number> {
	const account = store.xAccount();
	if (!account || !xReady(store, cfg, now)) return 0;
	if (
		account.lastMentionsAt &&
		now.getTime() - new Date(account.lastMentionsAt).getTime() <
			cfg.x.mentionsEveryMinutes * 60_000
	) {
		return 0;
	}
	const params = new URLSearchParams({
		max_results: "10",
		"tweet.fields": "author_id,conversation_id,created_at,referenced_tweets",
		expansions: "author_id",
		"user.fields": "username",
	});
	if (account.lastMentionId) params.set("since_id", account.lastMentionId);
	const r = await call<{
		data?: Tweet[];
		includes?: { users?: { id: string; username: string }[] };
		meta?: { newest_id?: string };
	}>(
		store,
		"GET",
		`users/${account.userId}/mentions?${params}`,
		undefined,
		now,
		env,
		doFetch,
	);
	const tweets = r.data ?? [];
	chargeX(store, now, READ_USD * Math.max(1, tweets.length));
	const users = new Map(
		(r.includes?.users ?? []).map((u) => [u.id, u.username]),
	);
	const convs = store.conversations();
	for (const t of tweets.slice().reverse()) {
		if (t.author_id === account.userId) continue;
		const cid = t.conversation_id ?? t.id;
		let c = convs.find((x) => x.id === cid);
		if (!c) {
			c = { id: cid, messages: [], pending: [], lastAt: now.toISOString() };
			convs.push(c);
		}
		if (c.messages.some((m) => m.id === t.id)) continue;
		c.messages.push({
			id: t.id,
			authorId: t.author_id ?? "",
			username: users.get(t.author_id ?? "") ?? "?",
			// 来客の言葉。材料としてだけ読む(頭にもそう伝える)。長すぎるものは切る
			text: t.text.slice(0, 1000),
			at: t.created_at ?? now.toISOString(),
			byAshi: false,
			replyTo: t.referenced_tweets?.find((x) => x.type === "replied_to")?.id,
		});
		c.pending.push(t.id);
		c.lastAt = now.toISOString();
	}
	// 古い会話から捨てて 100 件に保つ
	store.saveConversations(
		convs.sort((a, b) => a.lastAt.localeCompare(b.lastAt)).slice(-100),
	);
	store.saveXAccount({
		...(store.xAccount() ?? account),
		lastMentionId: r.meta?.newest_id ?? account.lastMentionId,
		lastMentionsAt: now.toISOString(),
	});
	return tweets.length;
}

/** 投稿する(replyTo があれば返信)。投稿した会話に Ashi の言葉として残す */
export async function postToX(
	store: Store,
	text: string,
	now: Date,
	replyTo?: { tweetId: string; conversationId: string },
	env: Env = process.env,
	doFetch: typeof fetch = fetch,
): Promise<string> {
	const account = store.xAccount();
	if (!account) throw new XError("X のアカウントがつながっていない", 0);
	const r = await call<{ data?: { id: string } }>(
		store,
		"POST",
		"tweets",
		{
			text,
			...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo.tweetId } } : {}),
		},
		now,
		env,
		doFetch,
	);
	const id = r.data?.id;
	if (!id) throw new XError("X が投稿の ID を返さなかった", 0);
	chargeX(store, now, writeUsd(text), replyTo ? "reply" : "post");
	const convs = store.conversations();
	const cid = replyTo?.conversationId ?? id;
	let c = convs.find((x) => x.id === cid);
	if (!c) {
		c = { id: cid, messages: [], pending: [], lastAt: now.toISOString() };
		convs.push(c);
	}
	const mine: XMessage = {
		id,
		authorId: account.userId,
		username: account.username,
		text,
		at: now.toISOString(),
		byAshi: true,
		replyTo: replyTo?.tweetId,
	};
	c.messages.push(mine);
	c.lastAt = now.toISOString();
	store.saveConversations(convs);
	return id;
}

/** 返事を考える会話(pending のあるもの)。古い順 */
export function pendingConversations(store: Store): XConversation[] {
	return store
		.conversations()
		.filter((c) => c.pending.length > 0)
		.sort((a, b) => a.lastAt.localeCompare(b.lastAt));
}

/** 返事を考え終えた(返した・返さないと決めた)メンションを pending から外す */
export function settle(
	store: Store,
	conversationId: string,
	mentionIds: string[],
): void {
	store.saveConversations(
		store
			.conversations()
			.map((c) =>
				c.id === conversationId
					? { ...c, pending: c.pending.filter((p) => !mentionIds.includes(p)) }
					: c,
			),
	);
}

/** X のつまずきを、人が直せる形に */
export function xBlockage(e: unknown): Blockage {
	const status = e instanceof XError ? e.status : 0;
	const detail = e instanceof Error ? e.message : String(e);
	if (status === 401 || status === 403) {
		return {
			key: "x:auth",
			title: "X のアカウントの鍵が通らない",
			detail,
			remedy:
				"/x からアカウントをつなぎ直す。403 が続くなら、X の開発者ポータルでアプリの権限が Read and write になっているか、プランで投稿と読み取りができるかを確かめる。",
		};
	}
	if (status === 429) {
		return {
			key: "x:limit",
			title: "X の回数の上限に当たった",
			detail,
			remedy:
				"しばらく待てば戻る。続くなら ASHI_CONFIG の x.mentionsEveryMinutes を長くする。",
		};
	}
	if (status === 402) {
		return {
			key: "x:billing",
			title: "X の API の残高が足りない",
			detail,
			remedy:
				"X の開発者ポータルでクレジットを足す。Ashi の 1 日の上限は ASHI_CONFIG の x.dailyUsd。",
		};
	}
	return {
		key: "x:error",
		title: "X でつまずいた",
		detail,
		remedy: "続くようなら /x の様子と足どりを見る。",
	};
}
