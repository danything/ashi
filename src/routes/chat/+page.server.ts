import { chatInFlight } from "$lib/server/ashi/legs/chat";
import { md } from "$lib/server/markdown";
import { store } from "$lib/server/runtime";
import type { PageServerLoad } from "./$types";

/** 画面に出す前回までの対話の数 */
const PAST = 30;

export const load: PageServerLoad = ({ locals }) => ({
	/** 前回までの対話。古い順 */
	past: store
		.recentChats(PAST)
		.reverse()
		.map((c) => ({
			at: c.at,
			question: c.question,
			reply: c.reply,
			html: md(c.reply),
			added: c.added ?? [],
		})),
	/** いま頭が考えている発言(返事を待つ間に画面を移って戻ったとき) */
	pending: chatInFlight(locals.user?.name ?? "?") ?? null,
});
