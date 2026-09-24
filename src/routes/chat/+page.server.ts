import { md } from "$lib/server/markdown";
import { store } from "$lib/server/runtime";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
	/** 前回までの対話。古い順 */
	past: store
		.recentChats(10)
		.reverse()
		.map((c) => ({
			at: c.at,
			question: c.question,
			reply: c.reply,
			html: md(c.reply),
		})),
});
