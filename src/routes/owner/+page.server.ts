import { fail } from "@sveltejs/kit";
import { fetchUrlTool } from "$lib/server/ashi/legs/tools";
import { newId } from "$lib/server/ashi/state";
import { md } from "$lib/server/markdown";
import { store, wakeNow } from "$lib/server/runtime";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	const walk = store.walk();
	const cfg = store.config();
	const states = store.feedStates();
	return {
		feeds: cfg.feeds.map((f) => ({
			...f,
			state: states[f.id],
			requested: walk.crawlRequests.includes(f.id),
		})),
		feedMinHours: cfg.feedMinHours,
		html: md(store.owner()),
		sources: store.sources().reverse(),
		pending: store.materialCount() - walk.profiledMaterials,
		profileEvery: cfg.profileEvery,
	};
};

const MAX_BODY = 100_000;

export const actions: Actions = {
	/** 持ち主の書いたものを貼り付けて渡す */
	paste: async ({ request }) => {
		const f = await request.formData();
		const title =
			String(f.get("title") ?? "")
				.trim()
				.slice(0, 200) || "無題";
		const body = String(f.get("body") ?? "").trim();
		if (!body) return fail(400, { message: "本文が空です" });
		if (body.length > MAX_BODY)
			return fail(400, {
				message: `長すぎます(${MAX_BODY.toLocaleString()} 文字まで)`,
			});
		store.addSource(
			{
				id: newId(),
				title,
				kind: "paste",
				createdAt: new Date().toISOString(),
			},
			body,
		);
		return { added: title };
	},
	/** 持ち主の書いたページ(ブログなど)を読み込んで渡す。読むのは頭の道具と同じ fetch_url(手元のネットワークは読まない) */
	url: async ({ request }) => {
		const f = await request.formData();
		const url = String(f.get("url") ?? "").trim();
		try {
			const text = await fetchUrlTool(store.config()).run({ url });
			const title = String(f.get("title") ?? "").trim() || url;
			store.addSource(
				{
					id: newId(),
					title,
					kind: "url",
					url,
					createdAt: new Date().toISOString(),
				},
				text,
			);
			return { added: title };
		} catch (e) {
			return fail(400, { message: e instanceof Error ? e.message : String(e) });
		}
	},
	remove: async ({ request }) => {
		const f = await request.formData();
		store.removeSource(String(f.get("id") ?? ""));
		return {};
	},
	/** 頭の判断を待たず、次の 1 歩で足跡を全部読みに行かせる(間隔の下限は守る) */
	crawl: () => {
		const w = store.walk();
		store.saveWalk({
			...w,
			crawlRequests: store.config().feeds.map((f) => f.id),
		});
		wakeNow();
		return { crawl: true };
	},
	/** 材料が増えていなくても、次の 1 歩で地図を書き直させる */
	reprofile: () => {
		store.saveWalk({
			...store.walk(),
			lastProfileStep: 0,
			profiledMaterials: -1,
		});
		wakeNow();
		return { reprofile: true };
	},
};
