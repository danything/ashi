import type { Store, XConversation } from "../state.ts";
import { call, chargeX, READ_USD, XError } from "./x.ts";

/**
 * X Activity API で、Ashi へのメンションと返信をその場で受け取る(見に行く方式だと返事が遅れた)。
 *
 * - 購読: post.mention.create(@メンション)と post.reply.create(Ashi の投稿への直接の返信)を、
 *   Ashi のアカウントの user_id で。非公開のイベントなので、Ashi の利用者トークン(tweet.read)で作る。
 *   一覧はアプリの鍵で読む(利用者トークンだと 403)
 * - 受け取り: GET /2/activity/stream を張りっぱなしにする(アプリの Bearer)。外に受け口を開けずに済む
 * - 料金: 届いたイベント 1 件ごとに投稿の読み取り 1 件分(0.005 ドル)。見に行く方式と同じ
 * - backfill_minutes(切れていた間の分をもらう)は今のプランでは 400 になる。切れていた間の分は見に行く方式が拾う
 * - X は最初の keep-alive(約 20 秒後)と一緒にヘッダーを返すので、つながるまで 20 秒ほどかかる
 * - 切れたら少し待って張り直す。張れないとき(Bearer が別のアプリなど)は、見に行く方式が 5 分おきに回る
 */

const API = "https://api.x.com/2";
export const STREAM_EVENTS = [
	"post.mention.create",
	"post.reply.create",
] as const;

type Env = Record<string, string | undefined>;

interface Subscription {
	subscription_id?: string;
	event_type?: string;
	filter?: { user_id?: string };
}

/** Ashi のアカウントの購読が無ければ作る。作ったものの event_type を返す */
export async function ensureSubscriptions(
	store: Store,
	now: Date,
	env: Env = process.env,
	doFetch: typeof fetch = fetch,
): Promise<string[]> {
	const account = store.xAccount();
	if (!account) return [];
	// 一覧はアプリの鍵(Bearer)で読む。利用者トークンで読むと 403 になる(2026-09-25、これで
	// 「X Activity API が使えない」と取り違えていた)。作るほうは利用者トークン(非公開のイベントなので)
	const bearer = env.X_BEARER_TOKEN;
	if (!bearer) return [];
	const res = await doFetch(`${API}/activity/subscriptions`, {
		headers: { authorization: `Bearer ${bearer}` },
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok)
		throw new XError(
			`X ${res.status}: ${(await res.text()).slice(0, 300)}`,
			res.status,
		);
	const list = (await res.json()) as { data?: Subscription[] };
	const have = new Set(
		(list.data ?? [])
			.filter((s) => s.filter?.user_id === account.userId)
			.map((s) => s.event_type ?? ""),
	);
	const created: string[] = [];
	for (const event_type of STREAM_EVENTS) {
		if (have.has(event_type)) continue;
		await call(
			store,
			"POST",
			"activity/subscriptions",
			{ event_type, filter: { user_id: account.userId }, tag: "ashi" },
			now,
			env,
			doFetch,
		);
		created.push(event_type);
	}
	return created;
}

interface StreamEvent {
	data?: {
		event_type?: string;
		payload?: {
			id?: string;
			text?: string;
			author_id?: string;
			conversation_id?: string;
			created_at?: string;
			referenced_tweets?: { type: string; id: string }[];
			in_reply_to_tweet_id?: string;
		};
		includes?: { users?: { id: string; username: string }[] };
	};
}

const newer = (a: string | undefined, b: string) => {
	try {
		return !a || BigInt(b) > BigInt(a);
	} catch {
		return true;
	}
};

/**
 * 届いたイベントを会話に足して返事待ちにする。足したら true。
 * Ashi 自身の投稿・重複は足さない。lastMentionId も進める(見に行く方式で同じものを読み直して払わないように)
 */
export function acceptStreamEvent(
	store: Store,
	line: string,
	now: Date,
): boolean {
	let ev: StreamEvent;
	try {
		ev = JSON.parse(line) as StreamEvent;
	} catch {
		return false;
	}
	const type = ev.data?.event_type;
	const p = ev.data?.payload;
	if (
		!type ||
		!(STREAM_EVENTS as readonly string[]).includes(type) ||
		!p?.id ||
		!p.text
	)
		return false;
	const account = store.xAccount();
	if (!account || p.author_id === account.userId) return false;
	chargeX(store, now, READ_USD);
	const convs = store.conversations();
	const cid = p.conversation_id ?? p.id;
	let c: XConversation | undefined = convs.find((x) => x.id === cid);
	if (c?.messages.some((m) => m.id === p.id)) return false;
	if (!c) {
		c = { id: cid, messages: [], pending: [], lastAt: now.toISOString() };
		convs.push(c);
	}
	const username =
		ev.data?.includes?.users?.find((u) => u.id === p.author_id)?.username ??
		"?";
	c.messages.push({
		id: p.id,
		authorId: p.author_id ?? "",
		username,
		text: p.text.slice(0, 1000),
		at: p.created_at ?? now.toISOString(),
		byAshi: false,
		replyTo:
			p.in_reply_to_tweet_id ??
			p.referenced_tweets?.find((r) => r.type === "replied_to")?.id,
	});
	c.pending.push(p.id);
	c.lastAt = now.toISOString();
	store.saveConversations(
		convs.sort((a, b) => a.lastAt.localeCompare(b.lastAt)).slice(-100),
	);
	if (newer(account.lastMentionId, p.id))
		store.saveXAccount({ ...account, lastMentionId: p.id });
	store.log("mentions", { count: 1, via: "stream" });
	return true;
}

/**
 * ストリームを張りっぱなしにする。行ごとに onLine を呼ぶ。止めるのは signal。
 * 返すのは、張れた(200 が返った)かどうか。切れたら呼び出し側が張り直す
 */
export async function readStream(
	onLine: (line: string) => void,
	signal: AbortSignal,
	env: Env = process.env,
	doFetch: typeof fetch = fetch,
	/** 200 が返ってつながったとき */
	onOpen?: () => void,
): Promise<{ ok: boolean; status: number }> {
	const bearer = env.X_BEARER_TOKEN;
	if (!bearer) return { ok: false, status: 0 };
	const res = await doFetch(`${API}/activity/stream`, {
		headers: { authorization: `Bearer ${bearer}` },
		signal,
	});
	if (!res.ok || !res.body) return { ok: false, status: res.status };
	onOpen?.();
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	while (!signal.aborted) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let i = buf.indexOf("\n");
		while (i >= 0) {
			const line = buf.slice(0, i).trim();
			buf = buf.slice(i + 1);
			// 空行はつながっている印(keep-alive)
			if (line) onLine(line);
			i = buf.indexOf("\n");
		}
	}
	return { ok: true, status: res.status };
}
