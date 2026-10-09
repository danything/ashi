import {
	type Head,
	HeadAccessError,
	HeadError,
	type Tool,
	type Turn,
} from "../head/head.ts";
import {
	CHAT_REWRITE_SCHEMA,
	CHAT_SCHEMA,
	type ChatAnswer,
	chatPrompt,
	chatRewritePrompt,
	correctionsBlock,
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
	acceptClaims,
	acceptNewQuestions,
	acceptProposals,
	addStances,
	allowance,
	claimQuestions,
	markedClaims,
	mergeClaims,
	trimOpenQuestions,
} from "./guard.ts";
import { newsBlock } from "./news.ts";
import { addPhrases, lintReply, phraseLedger } from "./style.ts";
import { crawlIds } from "./walk.ts";

/**
 * 持ち主との対話。何を学んだかを聞く、調べ物を頼む。
 * 持ち主の発言は chat.jsonl に残り、持ち主の地図の材料になる(walk.ts の profile)。
 * 予算は歩みと同じ財布から出す。
 */

export class ChatRefused extends Error {}

const MAX_TURNS = 20;
const MAX_CHARS = 4000;
/** 質問で終わる返事の続きを数えるのに見る、前の返事の数 */
const ASK_HISTORY = 2;

/**
 * いま頭が考えている発言(話しかけた人ごと)。返事を待つ間に画面を移って戻ると、送った発言が
 * 保存前で見えず、消えたように見えた。画面はこれを見て「考えている」を出し、返事が来るまで待つ。
 * 1 プロセスなので、ここに持てば足りる
 */
const thinking = new Map<string, { question: string; at: string }>();

export function chatInFlight(
	by: string,
): { question: string; at: string } | undefined {
	return thinking.get(by);
}

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

	thinking.set(by, { question: text, at: now.toISOString() });
	const phrases = phraseLedger(store).map((p) => p.text);
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
				newsBlock(store.news().items),
				correctionsBlock(
					store.walk().ownerCorrections ?? [],
					cfg.ownerCorrections,
				),
				phrases,
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
			// 返事の中で記憶だけで言ったことも、確かめる問いにして控える(頭の申告と、足が印から拾ったもの)
			const claims = mergeClaims(
				acceptClaims(output.unverified),
				markedClaims([String(output.reply ?? "")]),
			);
			const checks = acceptNewQuestions(
				claimQuestions(claims, "持ち主に"),
				[...qs, ...got],
				{ ...cfg, maxNewQuestions: claims.length },
				undefined,
				now,
				{ source: "chat" },
			).map((q) => ({ ...q, verify: true }));
			added = [...got, ...checks].map((q) => q.text);
			return trimOpenQuestions([...qs, ...got, ...checks], cfg);
		});
		// 読みに行くのは次の歩みで(対話の返事は待たせない)。取った立場は内省で見せる
		const crawl = crawlIds(output.crawl);
		const w = store.walk();
		store.saveWalk({
			...w,
			crawlRequests: [...new Set([...w.crawlRequests, ...crawl])],
			stances: addStances(w.stances, output.stances, now),
			// 伝えた訂正は台帳から消す
			ownerCorrections: (w.ownerCorrections ?? []).filter(
				(c) =>
					!(
						Array.isArray(output.delivered_corrections)
							? output.delivered_corrections
							: []
					).includes(c.id),
			),
		});
		let reply = String(output.reply ?? "").trim() || "(返事が空でした)";
		// 返す前に数え、当たったら中身を変えずに 1 回だけ書き直させる(持ち主の指摘、2026-10-09)
		const lint = lintReply(
			reply,
			phrases,
			store.recentChats(ASK_HISTORY).map((c) => c.reply),
		);
		let rewritten = false;
		if (lint.length) {
			try {
				const r = await head.think<{ reply: string }>({
					task: "chat-rewrite",
					system: system(store.core(), store.self(), store.owner()),
					prompt: chatRewritePrompt(reply, lint),
					schema: CHAT_REWRITE_SCHEMA,
					maxCostUsd: Math.max(0, left - usage.costUsd),
				});
				store.charge(today, r.usage);
				const again = String(r.output.reply ?? "").trim();
				if (again) {
					reply = again;
					rewritten = true;
				}
			} catch (e) {
				// 書き直せなければ、最初の返事のまま返す(返事を止めない)
				if (e instanceof HeadError) store.charge(today, e.usage);
				else throw e;
			}
		}
		// 持ち主が指摘した言い回しは台帳に、頼まれた改善案は「直すこと」に積む
		const flagged = addPhrases(store, output.flagged_phrases, "owner", now);
		const { proposals, added: proposed } = acceptProposals(
			output.proposals,
			store.proposals(),
			now,
		);
		if (proposed.length) store.saveProposals(proposals);
		// 拠ったノート。あとで同じテーマのノートが増えたら、内省でこの返事を全文で見せる(Ashi の改善案、2026-10-06)
		const known = new Set(store.notes().map((n) => n.id));
		const notes = [
			...new Set([
				...(Array.isArray(output.notes_used) ? output.notes_used : []),
				...(reply.match(/\b[0-9a-f]{8}\b/g) ?? []),
			]),
		]
			.filter((id): id is string => typeof id === "string" && known.has(id))
			.slice(0, 10);
		store.appendChat({
			at: now.toISOString(),
			by,
			question: text,
			reply,
			added,
			...(notes.length ? { notes } : {}),
			...(lint.length ? { lint, rewritten } : {}),
			usd: usage.costUsd,
		});
		store.log("chat", {
			by,
			added,
			usd: usage.costUsd,
			...(lint.length ? { lint, rewritten } : {}),
			...(flagged.length ? { flagged } : {}),
			...(proposed.length ? { proposed } : {}),
		});
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
	} finally {
		thinking.delete(by);
	}
}
