import {
	type Head,
	HeadAccessError,
	HeadError,
	type Tool,
	type Turn,
} from "../head/head.ts";
import {
	CHAT_SCHEMA,
	type ChatAnswer,
	chatPrompt,
	system,
} from "../prompts.ts";
import { localDay, type Store } from "../state.ts";
import {
	blockersText,
	raiseBlocker,
	resolveBlockers,
	webhookNotify,
} from "./blockers.ts";
import { feedStatus } from "./feeds.ts";
import {
	acceptNewQuestions,
	addStances,
	allowance,
	trimOpenQuestions,
} from "./guard.ts";
import { crawlIds } from "./walk.ts";

/**
 * 持ち主との対話。何を学んだかを聞く、調べ物を頼む。
 * 持ち主の発言は chat.jsonl に残り、持ち主の地図の材料になる(walk.ts の profile)。
 * 予算は歩みと同じ財布から出す。
 */

export class ChatRefused extends Error {}

const MAX_TURNS = 20;
const MAX_CHARS = 4000;

export async function chat(
	ctx: {
		store: Store;
		head: Head;
		tools: Tool[];
		now?: () => Date;
		notify?: (text: string) => Promise<void>;
	},
	by: string,
	history: Turn[],
	message: string,
): Promise<{ reply: string; added: string[]; crawl: string[]; usd: number }> {
	const { store, head } = ctx;
	const now = ctx.now?.() ?? new Date();
	const today = localDay(now);
	const cfg = store.config();
	const text = message.trim().slice(0, MAX_CHARS);
	if (!text) throw new ChatRefused("何か書いてください");
	const left = allowance(store.budget(today), cfg);
	if (left <= 0)
		throw new ChatRefused(
			"今日の予算を使い切りました。明日また話しかけてください",
		);

	const turns = history
		.slice(-MAX_TURNS)
		.filter(
			(t) =>
				(t.role === "user" || t.role === "assistant") &&
				typeof t.text === "string" &&
				t.text.trim(),
		)
		.map((t) => ({ role: t.role, text: t.text.slice(0, MAX_CHARS) }));
	// 先頭は user でなければならない
	while (turns[0]?.role === "assistant") turns.shift();

	try {
		const { output, usage } = await head.think<ChatAnswer>({
			task: "chat",
			system: system(store.core(), store.self(), store.owner()),
			history: turns,
			prompt: chatPrompt(
				text,
				store.notes(),
				store.questions(),
				feedStatus(store, now),
				blockersText(store),
			),
			schema: CHAT_SCHEMA,
			tools: ctx.tools.filter((t) => t.readOnly === true),
			maxToolRounds: 4,
			maxCostUsd: left,
		});
		store.charge(today, usage);
		resolveBlockers(store, "head:", now);
		let added: string[] = [];
		store.updateQuestions((qs) => {
			const got = acceptNewQuestions(
				output.new_questions,
				qs,
				cfg,
				undefined,
				now,
				{ source: "chat" },
			);
			added = got.map((q) => q.text);
			return trimOpenQuestions([...qs, ...got], cfg);
		});
		// 読みに行くのは次の歩みで(対話の返事は待たせない)。取った立場は内省で見せる
		const crawl = crawlIds(output.crawl);
		const w = store.walk();
		store.saveWalk({
			...w,
			crawlRequests: [...new Set([...w.crawlRequests, ...crawl])],
			stances: addStances(w.stances, output.stances, now),
		});
		const reply = String(output.reply ?? "").trim() || "(返事が空でした)";
		store.appendChat({
			at: now.toISOString(),
			by,
			question: text,
			reply,
			usd: usage.costUsd,
		});
		store.log("chat", { by, added, usd: usage.costUsd });
		return { reply, added, crawl, usd: usage.costUsd };
	} catch (e) {
		if (e instanceof HeadError) store.charge(today, e.usage);
		if (e instanceof HeadAccessError)
			await raiseBlocker(
				store,
				"head",
				e.blockage,
				now,
				ctx.notify ?? webhookNotify,
			);
		throw e;
	}
}
