import type { Store, XCleanup } from "../state.ts";
import { call, XError } from "./x.ts";

/**
 * X のアカウントの前の用途の投稿を消す(2026-09-25、DoanyBot に録画のエンコード通知が 5,414 件あった)。
 *
 * - ID は X のアーカイブの data/tweets.js から取る。API の一覧は新しい 3,200 件までしか返さず、
 *   読み取りは 1 件 0.005 ドルかかるので、アーカイブのほうが全件取れて安い
 * - 消すのは Ashi をつなぐより前の投稿だけ。Ashi の投稿は消さない
 * - 削除は 15 分に 50 件まで(X の上限)。runCleanup を 15 分ごとに呼ぶ
 */

export const CLEANUP_BATCH = 50;
export const CLEANUP_EVERY_MS = 15 * 60_000;

interface ArchivedTweet {
	tweet?: { id_str?: string; id?: string; created_at?: string };
}

/**
 * アーカイブの tweets.js(`window.YTD.tweets.part0 = [...]`)から、消してよい投稿の ID を取り出す。
 * before より後に作られたもの(Ashi をつないだ後)と、keep に入っているものは外す
 */
export function parseArchive(
	text: string,
	before: Date,
	keep: Set<string>,
): string[] {
	const start = text.indexOf("[");
	if (start < 0) throw new Error("tweets.js の形ではない(配列が見つからない)");
	const list = JSON.parse(text.slice(start)) as ArchivedTweet[];
	const ids: string[] = [];
	for (const item of list) {
		const id = item.tweet?.id_str ?? item.tweet?.id;
		if (!id || keep.has(id)) continue;
		const at = item.tweet?.created_at
			? new Date(item.tweet.created_at)
			: undefined;
		if (at && !Number.isNaN(at.getTime()) && at >= before) continue;
		ids.push(id);
	}
	return [...new Set(ids)];
}

/** Ashi が投稿したもの(消さない) */
export function ashiPostIds(store: Store): Set<string> {
	return new Set(
		store
			.conversations()
			.flatMap((c) => c.messages.filter((m) => m.byAshi).map((m) => m.id)),
	);
}

export function startCleanup(store: Store, ids: string[], now: Date): XCleanup {
	const c: XCleanup = {
		total: ids.length,
		remaining: ids,
		deleted: 0,
		failed: [],
		startedAt: now.toISOString(),
	};
	store.saveXCleanup(c);
	store.log("x-cleanup-started", { total: ids.length });
	return c;
}

/** 50 件まで消す。429 なら今回はそこで止め、次の回に回す */
export async function runCleanup(
	store: Store,
	now: Date,
	env: Record<string, string | undefined> = process.env,
	doFetch: typeof fetch = fetch,
): Promise<{ deleted: number; left: number } | undefined> {
	const c = store.xCleanup();
	if (!c || c.remaining.length === 0 || !store.xAccount()) return undefined;
	const keep = ashiPostIds(store);
	let deleted = 0;
	let lastError: string | undefined;
	const done: string[] = [];
	const failed: string[] = [];
	for (const id of c.remaining.slice(0, CLEANUP_BATCH)) {
		if (keep.has(id)) {
			done.push(id);
			continue;
		}
		try {
			await call(store, "DELETE", `tweets/${id}`, undefined, now, env, doFetch);
			deleted++;
			done.push(id);
		} catch (e) {
			const status = e instanceof XError ? e.status : 0;
			if (status === 404) {
				// もう無い
				done.push(id);
				continue;
			}
			lastError = e instanceof Error ? e.message.slice(0, 300) : String(e);
			if (status === 429) break;
			if (status === 401) break;
			failed.push(id);
			done.push(id);
		}
	}
	const gone = new Set(done);
	const next: XCleanup = {
		...c,
		remaining: c.remaining.filter((id) => !gone.has(id)),
		deleted: c.deleted + deleted,
		failed: [...c.failed, ...failed].slice(-500),
		lastRunAt: now.toISOString(),
		lastError,
	};
	store.saveXCleanup(next);
	if (next.remaining.length === 0)
		store.log("x-cleanup-finished", {
			deleted: next.deleted,
			failed: next.failed.length,
		});
	return { deleted, left: next.remaining.length };
}
