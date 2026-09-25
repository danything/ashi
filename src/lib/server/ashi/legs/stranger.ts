import type { Head, Usage } from "../head/head.ts";
import {
	DIALOGUE_FINAL_SCHEMA,
	DIALOGUE_REPLY_SCHEMA,
	dialoguePrompt,
	dialogueSystem,
	STRANGER_SCHEMA,
	strangerPrompt,
	strangerSystem,
} from "../prompts.ts";
import type { Dialogue, Store } from "../state.ts";
import {
	acceptClaims,
	acceptNewQuestions,
	claimQuestions,
	type RawQuestion,
	trimOpenQuestions,
} from "./guard.ts";

/**
 * よそ者との対話。内省のたびに、持ち主の地図を知らない別のモデルと短く話し、個性の問いの種にする。
 *
 * 個性(self)の問いは「持ち主の地図から一歩外れた方向」を頼んでいたが、実際には出どころの分かるもの
 * 全部が持ち主の関心から派生していた(2026-09-25、ownerPull 24 / 24)。X の来客がよその関心を持ち込む
 * はずだったが、話しかけてきたのは持ち主だけだった。人が新しい発想を得るのは、批評されたときより
 * 違うことに興味がある人と話したときなので、採点役ではなく話し相手を置く。
 *
 * - 相手は頭と別のモデル(既定 Sonnet 5)。賢さより癖が違うことが効く
 * - 相手の関心の分野は足がさいころで選ぶ(毎回同じ人格に固まらないように)
 * - 相手には持ち主の地図も自己記述も見せない。先に話すのも相手(Ashi が話題を持ち主の側へ寄せないように)
 * - 決めるのは Ashi。会話から出した問いも、ほかの問いと同じガードレールを通す
 * - 生まれた問いの出どころは stranger(via にモデルと分野)。ownerPull で効き目を測る
 */

export const STRANGER_FIELDS = [
	"生物学",
	"古代史",
	"音楽",
	"数学",
	"料理",
	"天文学",
	"建築",
	"言語学",
	"民俗学",
	"地質学",
	"園芸",
	"鉄道",
	"囲碁や将棋",
	"医学史",
	"海洋",
	"昆虫",
	"服飾",
	"気象",
	"考古学",
	"映画",
] as const;

const MAX_TURN_CHARS = 1200;

export interface StrangerTalk {
	dialogue: Dialogue;
	usage: Usage;
}

export async function talkWithStranger(opts: {
	store: Store;
	head: Head;
	stranger: Head;
	turns: number;
	now: Date;
	rng?: () => number;
}): Promise<StrangerTalk> {
	const { store, head, stranger, now } = opts;
	const rng = opts.rng ?? Math.random;
	const field =
		STRANGER_FIELDS[Math.floor(rng() * STRANGER_FIELDS.length)] ??
		STRANGER_FIELDS[0];
	const turns: Dialogue["turns"] = [];
	const usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
	const add = (u: Usage) => {
		usage.inputTokens += u.inputTokens;
		usage.outputTokens += u.outputTokens;
		usage.costUsd += u.costUsd;
	};
	const text = (v: unknown) =>
		typeof v === "string" ? v.trim().slice(0, MAX_TURN_CHARS) : "";

	let final: {
		new_questions?: RawQuestion[];
		takeaway?: unknown;
		unverified?: unknown;
	} = {};
	const n = Math.max(1, opts.turns);
	for (let i = 0; i < n; i++) {
		const s = await stranger.think<{ reply: string }>({
			task: "stranger",
			system: strangerSystem(field),
			prompt: strangerPrompt(turns),
			schema: STRANGER_SCHEMA,
		});
		add(s.usage);
		const said = text(s.output.reply);
		if (!said) break;
		turns.push({ by: "stranger", text: said });

		const last = i === n - 1;
		const a = await head.think<{
			reply: string;
			new_questions?: RawQuestion[];
			takeaway?: unknown;
			unverified?: unknown;
		}>({
			task: last ? "dialogue-final" : "dialogue",
			system: dialogueSystem(store.core(), store.self()),
			prompt: dialoguePrompt(turns, last),
			schema: last ? DIALOGUE_FINAL_SCHEMA : DIALOGUE_REPLY_SCHEMA,
		});
		add(a.usage);
		const reply = text(a.output.reply);
		if (reply) turns.push({ by: "ashi", text: reply });
		if (last) final = a.output;
	}

	let added: string[] = [];
	const raw = (Array.isArray(final.new_questions) ? final.new_questions : [])
		// よそ者から生まれた問いは個性の側
		.map((q) => ({ ...q, track: "self" }));
	// 会話の中で記憶だけで言ったことも、X と同じく確かめる問いにして控える(Ashi の改善案、2026-09-26。
	// 「記憶で言います」と断ったまま確かめない、が起きていた)
	const claims = acceptClaims(final.unverified);
	if (raw.length || claims.length) {
		const cfg = store.config();
		const from = {
			source: "stranger" as const,
			via: `${stranger.name}:${field}`,
		};
		store.updateQuestions((qs) => {
			const got = acceptNewQuestions(raw, qs, cfg, undefined, now, from);
			const checks = acceptNewQuestions(
				claimQuestions(claims, `${field}の話し相手に`),
				[...qs, ...got],
				{ ...cfg, maxNewQuestions: 3 },
				undefined,
				now,
				from,
			).map((q) => ({ ...q, verify: true }));
			added = [...got, ...checks].map((q) => q.text);
			return trimOpenQuestions([...qs, ...got, ...checks], cfg);
		});
	}
	const dialogue: Dialogue = {
		at: now.toISOString(),
		model: stranger.name,
		field,
		turns,
		added,
		takeaway: text(final.takeaway).slice(0, 300),
	};
	store.appendDialogue(dialogue);
	store.log("stranger", { field, model: stranger.name, added });
	return { dialogue, usage };
}
