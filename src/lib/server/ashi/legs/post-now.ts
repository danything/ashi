import type { Head, JsonSchema } from "../head/head.ts";
import { HeadError } from "../head/head.ts";
import { recentNotesText, system, X_VOICE } from "../prompts.ts";
import { localDay, type Store } from "../state.ts";
import { allowance } from "./guard.ts";
import { canPost, postToX, xLength } from "./x.ts";

/**
 * いま 1 件投稿させる(画面の「いま投稿させる」)。内省を待たずに、頭に 1 件書かせて投稿する。
 * 初めての投稿なら自己紹介。数・額・長さの上限は足が見る
 */

const POST_SCHEMA: JsonSchema = {
	type: "object",
	properties: {
		text: { type: "string", description: "投稿する文(日本語なら 140 字以内)" },
		why: { type: "string", description: "なぜこれを書いたか(足が残す)" },
	},
	required: ["text", "why"],
	additionalProperties: false,
};

export class PostRefused extends Error {}

export async function postNow(ctx: {
	store: Store;
	head: Head;
	now?: () => Date;
	env?: Record<string, string | undefined>;
	fetch?: typeof fetch;
}): Promise<{ text: string; id: string }> {
	const { store, head } = ctx;
	const now = ctx.now?.() ?? new Date();
	const cfg = store.config();
	if (!canPost(store, cfg, now))
		throw new PostRefused(
			"X がつながっていないか、今日の投稿の上限・額の上限に来ています",
		);
	const left = allowance(store.budget(localDay(now)), cfg);
	if (left <= 0) throw new PostRefused("今日の予算を使い切りました");
	const first = !store
		.conversations()
		.some((c) => c.messages.some((m) => m.byAshi));
	const prompt = `${
		first
			? `これは X での初めての投稿です。自己紹介をしてください。
何者か(葦の芽に足が生えたような AI「あし」で、自分で問いを選んで調べて歩いている)、最近どんなことを調べているか(下のノートから 1 つだけ、身近に言い換えて)、
そして読んだ人が思わず返したくなる問いかけで終えてください。持ち主が誰かは書かないこと。`
			: "いま X に 1 件投稿してください。最近のノートから、ほかの人と話すきっかけになる発見を 1 つ選んで書いてください。"
	}
日本語で 140 字以内。道具は使えません。

${X_VOICE}

最近のノート:
${recentNotesText(store.notes())}`;
	let output: { text?: string; why?: string };
	try {
		const r = await head.think<{ text: string; why: string }>({
			task: "post",
			system: system(store.core(), store.self(), store.owner()),
			prompt,
			schema: POST_SCHEMA,
			maxCostUsd: left,
		});
		store.charge(localDay(now), r.usage);
		output = r.output;
	} catch (e) {
		if (e instanceof HeadError) store.charge(localDay(now), e.usage);
		throw e;
	}
	const text = String(output.text ?? "").trim();
	if (!text) throw new PostRefused("頭が投稿する文を書かなかった");
	if (xLength(text) > 280)
		throw new PostRefused(`長すぎる(${xLength(text)} / 280): ${text}`);
	const id = await postToX(
		store,
		text,
		now,
		undefined,
		ctx.env ?? process.env,
		ctx.fetch ?? fetch,
	);
	store.log("posted", {
		text,
		why: String(output.why ?? "").slice(0, 300),
		first,
		id,
	});
	return { text, id };
}
