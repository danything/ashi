import { type Head, HeadAccessError, HeadError } from "../head/head.ts";
import {
	CONVERSE_SCHEMA,
	type ConverseAnswer,
	conversePrompt,
	system,
} from "../prompts.ts";
import { localDay, type Store } from "../state.ts";
import { raiseBlocker, resolveBlockers, webhookNotify } from "./blockers.ts";
import { acceptNewQuestions, allowance, trimOpenQuestions } from "./guard.ts";
import {
	canReply,
	fetchMentions,
	pendingConversations,
	postToX,
	settle,
	xBlockage,
	xLength,
	xReady,
} from "./x.ts";

/**
 * X のメンションを読み、届いていたら返すかを頭に決めさせる。歩みとは別に、サーバーのタイマーから回す。
 *
 * 歩みの中で読んでいた頃は、休んでいる間と 60 分の間隔の分だけ返事が遅れ、リプライに 1〜2 時間
 * 返らなかった(2026-09-25、持ち主の初回ツイートへのリプライ)。読むのは届いた件数ぶんしか
 * 課金されないので短い間隔で見に行き、頭(サブスク)を使うのは届いたときだけにする
 */
export async function checkMentions(ctx: {
	store: Store;
	head: Head;
	now?: () => Date;
	env?: Record<string, string | undefined>;
	fetch?: typeof fetch;
	notify?: (text: string) => Promise<void>;
	/** 見に行く間隔(分)。ストリームが張れている間は長く、張れないときは短く */
	pollMinutes?: number;
}): Promise<
	{ fetched: number; replied: string[]; skipped: number } | undefined
> {
	const { store, head } = ctx;
	const now = ctx.now?.() ?? new Date();
	const cfg = store.config();
	const env = ctx.env ?? process.env;
	const doFetch = ctx.fetch ?? fetch;
	const notify = ctx.notify ?? webhookNotify;
	if (!xReady(store, cfg, now)) return undefined;

	let fetched = 0;
	try {
		fetched = await fetchMentions(
			store,
			cfg,
			now,
			env,
			doFetch,
			ctx.pollMinutes ?? cfg.x.mentionsEveryMinutes,
		);
		if (fetched > 0) store.log("mentions", { count: fetched });
		// 見に行けたら片づくのは見に行く側のものだけ(x:stream はストリームがつながったときに片づける)
		for (const key of ["x:auth", "x:limit", "x:billing", "x:error"])
			resolveBlockers(store, key, now);
	} catch (e) {
		await raiseBlocker(store, "x", xBlockage(e), now, notify);
		return { fetched: 0, replied: [], skipped: 0 };
	}

	const waiting = pendingConversations(store).slice(-5);
	const today = localDay(now);
	const left = allowance(store.budget(today), cfg);
	if (waiting.length === 0 || !canReply(store, cfg, now) || left <= 0)
		return { fetched, replied: [], skipped: 0 };

	const remaining =
		cfg.x.maxRepliesPerDay - (store.budget(today).xReplies ?? 0);
	let output: ConverseAnswer;
	try {
		const r = await head.think<ConverseAnswer>({
			task: "converse",
			system: system(store.core(), store.self(), store.owner()),
			prompt: conversePrompt(waiting, remaining),
			schema: CONVERSE_SCHEMA,
			maxCostUsd: left,
		});
		store.charge(today, r.usage);
		resolveBlockers(store, "head:", now);
		output = r.output;
	} catch (e) {
		if (e instanceof HeadError) store.charge(today, e.usage);
		if (e instanceof HeadAccessError)
			await raiseBlocker(store, "head", e.blockage, now, notify);
		store.log("failed", {
			error: e instanceof Error ? e.message : String(e),
			task: "converse",
		});
		return { fetched, replied: [], skipped: 0 };
	}

	const replied: string[] = [];
	const skipped: { id: string; why: string }[] = [];
	for (const r of Array.isArray(output.replies) ? output.replies : []) {
		const conv = waiting.find((c) => c.pending.includes(String(r?.mention_id)));
		if (!conv) continue;
		const text = typeof r.text === "string" ? r.text.trim() : "";
		if (
			r.reply === true &&
			text &&
			xLength(text) <= 280 &&
			canReply(store, cfg, now)
		) {
			try {
				await postToX(
					store,
					text,
					now,
					{ tweetId: r.mention_id, conversationId: conv.id },
					env,
					doFetch,
				);
				replied.push(text);
			} catch (e) {
				await raiseBlocker(store, "x", xBlockage(e), now, notify);
				break;
			}
		} else {
			skipped.push({
				id: r.mention_id,
				why: String(r.why ?? "").slice(0, 200),
			});
		}
		settle(store, conv.id, [r.mention_id]);
	}
	// 来客から生まれた問いは個性の材料
	store.updateQuestions((qs) => {
		const raw = (output.new_questions ?? []).map((q) => ({
			...q,
			track: "self",
		}));
		return trimOpenQuestions(
			[...qs, ...acceptNewQuestions(raw, qs, cfg, undefined, now)],
			cfg,
		);
	});
	store.log("conversed", { replied, skipped });
	return { fetched, replied, skipped: skipped.length };
}
