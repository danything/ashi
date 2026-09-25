import { fail } from "@sveltejs/kit";
import { PostRefused, postNow } from "$lib/server/ashi/legs/post-now";
import { WRITE_USD, xConfigured } from "$lib/server/ashi/legs/x";
import {
	ashiPostIds,
	CLEANUP_BATCH,
	CLEANUP_EVERY_MS,
	parseArchive,
	startCleanup,
} from "$lib/server/ashi/legs/x-cleanup";
import { localDay } from "$lib/server/ashi/state";
import { getHead, kickCleanup, store } from "$lib/server/runtime";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	const cfg = store.config();
	const a = store.xAccount();
	const b = store.budget(localDay(new Date()));
	return {
		configured: xConfigured(),
		enabled: cfg.x.enabled,
		// トークンは画面に出さない
		account: a
			? {
					username: a.username,
					connectedAt: a.connectedAt,
					lastMentionsAt: a.lastMentionsAt,
				}
			: undefined,
		limits: cfg.x,
		today: { usd: b.xUsd ?? 0, posts: b.xPosts ?? 0, replies: b.xReplies ?? 0 },
		writeUsd: WRITE_USD,
		cleanup: (() => {
			const c = store.xCleanup();
			if (!c) return undefined;
			// 残りを 15 分に 50 件で割った目安
			const etaMs =
				Math.ceil(c.remaining.length / CLEANUP_BATCH) * CLEANUP_EVERY_MS;
			return {
				total: c.total,
				deleted: c.deleted,
				left: c.remaining.length,
				failed: c.failed.length,
				lastRunAt: c.lastRunAt,
				lastError: c.lastError,
				doneAt: c.remaining.length
					? new Date(Date.now() + etaMs).toISOString()
					: undefined,
			};
		})(),
		conversations: store
			.conversations()
			.slice()
			.sort((x, y) => y.lastAt.localeCompare(x.lastAt))
			.slice(0, 20),
	};
};

export const actions: Actions = {
	/** X のアーカイブの tweets.js を受け取り、Ashi をつなぐ前の投稿を消し始める */
	cleanup: async ({ request }) => {
		const account = store.xAccount();
		if (!account)
			return fail(400, {
				cleanupMessage: "先に Ashi のアカウントをつないでください",
			});
		const file = (await request.formData()).get("archive");
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { cleanupMessage: "tweets.js を選んでください" });
		try {
			const ids = parseArchive(
				await file.text(),
				new Date(account.connectedAt),
				ashiPostIds(store),
			);
			if (ids.length === 0)
				return fail(400, { cleanupMessage: "消す投稿が見つかりませんでした" });
			startCleanup(store, ids, new Date());
			kickCleanup();
			return { cleanupStarted: ids.length };
		} catch (e) {
			return fail(400, {
				cleanupMessage: e instanceof Error ? e.message : String(e),
			});
		}
	},
	cleanupStop: () => {
		store.saveXCleanup(undefined);
		store.log("x-cleanup-stopped");
		return {};
	},
	/** 内省を待たずに、いま 1 件投稿させる(初めてなら自己紹介) */
	postNow: async () => {
		try {
			const r = await postNow({ store, head: getHead() });
			return { posted: r.text, id: r.id };
		} catch (e) {
			return fail(e instanceof PostRefused ? 409 : 502, {
				message: e instanceof Error ? e.message : String(e),
			});
		}
	},
	disconnect: () => {
		store.saveXAccount(undefined);
		store.log("x-disconnected");
		return {};
	},
};
