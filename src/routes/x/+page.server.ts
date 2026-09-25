import { fail } from "@sveltejs/kit";
import { PostRefused, postNow } from "$lib/server/ashi/legs/post-now";
import { WRITE_USD, xConfigured } from "$lib/server/ashi/legs/x";
import { localDay } from "$lib/server/ashi/state";
import { getHead, store } from "$lib/server/runtime";
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
		conversations: store
			.conversations()
			.slice()
			.sort((x, y) => y.lastAt.localeCompare(x.lastAt))
			.slice(0, 20),
	};
};

export const actions: Actions = {
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
