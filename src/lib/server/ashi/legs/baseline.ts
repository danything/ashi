import type { Head, JsonSchema, Usage } from "../head/head.ts";
import { localDay, type Store } from "../state.ts";

/**
 * 自分の「型」の当たり率の基準線を測る。
 *
 * Ashi は「当たり前に見えるものは誰かの選択だった」のような型を、どの道でも見つける。考古学の話し相手に
 * 多重比較の話を聞いて、その型がどんな文章にも読み込めるなら、見つけたことに意味が無いと気づいた
 * (Ashi の改善案、2026-09-26)。比べる相手を足が用意する。
 *
 * - 1 日 1 回、内省の前に。次の 3 つを、どれか分からないように混ぜて、自己記述を渡さない頭に
 *   「この型が当てはまるか」だけを判定させる
 *     mine:     自己記述を渡して書いた個性のノート
 *     blind:    自己記述を渡さずに書いた個性のノート(対照。mine と同じ種類の文章)
 *     external: 外の文章(持ち主が渡した材料)。文章の種類が違うので参考
 *   外の文章だけを比べる相手にしていたら、ブログやコードと調べたノートでは文の種類が違い、差が型の
 *   持ち込みのせいか種類のせいか区別できなかった(Ashi の改善案、2026-09-27)。mine と blind を比べる
 * - 対照のノートはまだ少ないので、本数もあわせて見せる
 * - 型は内省で頭が挙げた言葉(walk.json の selfPatterns)。記録は log.jsonl の baseline
 * - 同じ判定に、開いた個性の問いの文(questions)と、対照のノートの元の問いの文(blindQuestions)も
 *   混ぜる。問いを作るのは自己記述を読んだ頭なので、対照のノートでも問いが型を運んでいれば対照に
 *   ならない。元の問いが型に当たらなかった対照だけの当たり率(blindClean)も出す(Ashi の改善案、
 *   2026-10-03。言葉の一致だけの carried では、言い換えた型を拾えなかった)
 */

const PER_SIDE = 4;
/** 混ぜる開いた問いの本数 */
const QUESTIONS = 6;
const DOC_CHARS = 1200;

const SCHEMA: JsonSchema = {
	type: "object",
	properties: {
		results: {
			type: "array",
			description:
				"文章ごとの判定。文章の記号(A, B, …)と、型ごとに当てはまるか(型の並びと同じ順)",
			items: {
				type: "object",
				properties: {
					doc: { type: "string" },
					applies: { type: "array", items: { type: "boolean" } },
				},
				required: ["doc", "applies"],
				additionalProperties: false,
			},
		},
	},
	required: ["results"],
	additionalProperties: false,
};

const SYSTEM = `あなたは文章を読んで、ある見方(型)がその文章に当てはまるかを判定する係です。
文章を書いた人や目的は知らなくてよく、推し量らないでください。
「当てはまる」は、その型で文章の中身を無理なく説明できるときだけ。こじつければ何にでも当てはまる、は当てはまらないに数えてください。
答えは指定された JSON の形だけで返してください。`;

/**
 * docs: 判定した文章の本数。carried: そのうち、ノートの元の問いの文に型の言葉が入っていたもの。
 * 対照(自己記述なし)で歩いても、問いの文が型を運んでいれば対照にならない(Ashi の改善案、2026-09-27)
 */
type Tally = { hits: number; total: number; docs: number; carried?: number };

export interface Baseline {
	patterns: string[];
	external: Tally;
	blind: Tally;
	mine: Tally;
	/** 開いた個性の問いの文 */
	questions?: Tally;
	/** 対照のノートの元の問いの文 */
	blindQuestions?: Tally;
	/** 対照のノートのうち、元の問いが型に当たらなかったものだけ */
	blindClean?: Tally;
}

type Side = "mine" | "blind" | "external" | "questions" | "blindQuestions";

function sample<T>(xs: T[], n: number, rng: () => number): T[] {
	const a = [...xs];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j] as T, a[i] as T];
	}
	return a.slice(0, n);
}

/**
 * 型の当たり率の累計。1 回 4 本ずつでは揺れが大きく、毎回の上下を読もうとして自己記述の数字を
 * 書き換えるだけになっていた(Ashi の改善案、2026-10-07)。型の言葉は回ごとに変わるので、ざっくりした目安
 */
export interface BaselineTotals {
	/** 足し始めた日時と、足した回数 */
	since: string;
	count: number;
	mine: Tally;
	blind: Tally;
	blindClean: Tally;
	questions: Tally;
}

const emptyTally = (): Tally => ({ hits: 0, total: 0, docs: 0 });
const addTally = (a: Tally, b?: Tally): Tally =>
	b
		? {
				hits: a.hits + b.hits,
				total: a.total + b.total,
				docs: a.docs + Math.max(0, b.docs),
			}
		: a;

/** 1 回分の基準線を累計に足す */
export function addBaseline(
	totals: BaselineTotals | undefined,
	b: Baseline,
	at: string,
): BaselineTotals {
	const t = totals ?? {
		since: at,
		count: 0,
		mine: emptyTally(),
		blind: emptyTally(),
		blindClean: emptyTally(),
		questions: emptyTally(),
	};
	return {
		since: t.since,
		count: t.count + 1,
		mine: addTally(t.mine, b.mine),
		blind: addTally(t.blind, b.blind),
		blindClean: addTally(t.blindClean, b.blindClean),
		questions: addTally(t.questions, b.questions),
	};
}

/** 累計がまだ無いとき、ログに残っている基準線から足し上げる(古い順) */
export function baselineTotalsFromLog(
	log: { event: string; at?: string; [k: string]: unknown }[],
): BaselineTotals | undefined {
	const bs = recentBaselines(log, Number.MAX_SAFE_INTEGER).reverse();
	let t: BaselineTotals | undefined;
	for (const b of bs) if (b.mine.docs >= 0) t = addBaseline(t, b, b.at);
	return t;
}

/** 割合の 95% の幅(Wilson)。判定は文章ごとに独立ではないので、ざっくりした目安 */
export function wilson(hits: number, total: number): [number, number] {
	if (total === 0) return [0, 1];
	const z = 1.96;
	const p = hits / total;
	const d = 1 + (z * z) / total;
	const c = p + (z * z) / (2 * total);
	const r = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
	return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}

/** 1 日 1 回だけ測る。型か比べる文章が足りなければ何もしない */
export async function measureBaseline(opts: {
	store: Store;
	head: Head;
	now: Date;
	rng?: () => number;
}): Promise<{ baseline: Baseline; usage: Usage } | undefined> {
	const { store, head, now } = opts;
	const rng = opts.rng ?? Math.random;
	const walk = store.walk();
	const patterns = walk.selfPatterns ?? [];
	const today = localDay(now);
	if (!patterns.length || walk.lastBaselineDay === today) return undefined;

	const external = sample(store.sources(), PER_SIDE, rng)
		.map((src) => (store.sourceBody(src.id) ?? "").trim().slice(0, DOC_CHARS))
		.filter((t) => t.length > 200);
	const selfIds = new Set(
		store
			.questions()
			.filter((q) => q.track === "self")
			.map((q) => q.id),
	);
	const selfNotes = store.notes().filter((n) => selfIds.has(n.questionId));
	const questionText = new Map(store.questions().map((q) => [q.id, q.text]));
	const carries = (questionId: string) =>
		patterns.some((p) => (questionText.get(questionId) ?? "").includes(p));
	const texts = (ns: typeof selfNotes) =>
		sample(ns, PER_SIDE, rng)
			.map((n) => ({
				text: (store.noteBody(n.id) ?? "").trim().slice(0, DOC_CHARS),
				carried: carries(n.questionId),
				questionId: n.questionId,
			}))
			.filter((t) => t.text.length > 200);
	const mineTexts = texts(
		selfNotes.filter((n) => !n.blind).slice(-PER_SIDE * 3),
	);
	const blindTexts = texts(selfNotes.filter((n) => n.blind));
	if (mineTexts.length < 2 || (blindTexts.length < 1 && external.length < 2))
		return undefined;

	// 確かめの問いは外で言ったことの写しなので混ぜない
	const openQuestions = sample(
		store
			.questions()
			.filter((q) => q.track === "self" && q.status === "open" && !q.verify),
		QUESTIONS,
		rng,
	).map((q) => ({
		text: q.text,
		carried: carries(q.id),
		side: "questions" as const,
	}));
	const blindQuestions = blindTexts.flatMap((t) => {
		const text = questionText.get(t.questionId);
		return text
			? [
					{
						text,
						carried: t.carried,
						side: "blindQuestions" as const,
						questionId: t.questionId,
					},
				]
			: [];
	});

	// どれの文章か分からないように混ぜて、記号だけを付ける
	const all: {
		text: string;
		carried: boolean;
		side: Side;
		questionId?: string;
	}[] = [
		...mineTexts.map((t) => ({ ...t, side: "mine" as const })),
		...blindTexts.map((t) => ({ ...t, side: "blind" as const })),
		...external.map((text) => ({
			text,
			carried: false,
			side: "external" as const,
		})),
		...openQuestions,
		...blindQuestions,
	];
	const docs = sample(all, all.length, rng).map((d, i) => ({
		...d,
		label: String.fromCharCode(65 + i),
	}));

	const prompt = `次の型が、それぞれの文章に当てはまるかを判定してください。

型(この順で applies に並べる):
${patterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}

${docs.map((d) => `<doc id="${d.label}">\n${d.text}\n</doc>`).join("\n\n")}`;

	const { output, usage } = await head.think<{
		results: { doc: string; applies: boolean[] }[];
	}>({ task: "baseline", system: SYSTEM, prompt, schema: SCHEMA });

	const zero = (side: string) => ({
		hits: 0,
		total: 0,
		docs: docs.filter((d) => d.side === side).length,
		carried: docs.filter((d) => d.side === side && d.carried).length,
	});
	const tally: Record<Side, Tally> = {
		external: zero("external"),
		blind: zero("blind"),
		mine: zero("mine"),
		questions: zero("questions"),
		blindQuestions: zero("blindQuestions"),
	};
	const judged = new Map<string, boolean[]>();
	for (const r of Array.isArray(output.results) ? output.results : []) {
		const d = docs.find((x) => x.label === r.doc);
		if (!d || !Array.isArray(r.applies)) continue;
		const answers = r.applies.slice(0, patterns.length);
		judged.set(d.label, answers);
		tally[d.side].total += answers.length;
		tally[d.side].hits += answers.filter((x) => x === true).length;
	}
	// 元の問いの文が型に 1 つも当たらなかった対照のノートだけで数え直す
	const questionHit = new Set(
		docs
			.filter(
				(d) =>
					d.side === "blindQuestions" &&
					(judged.get(d.label) ?? []).some((x) => x === true),
			)
			.map((d) => d.questionId),
	);
	const blindClean: Tally = { hits: 0, total: 0, docs: 0 };
	for (const d of docs) {
		if (d.side !== "blind" || questionHit.has(d.questionId)) continue;
		const answers = judged.get(d.label);
		blindClean.docs++;
		if (!answers) continue;
		blindClean.total += answers.length;
		blindClean.hits += answers.filter((x) => x === true).length;
	}
	const baseline: Baseline = { patterns, ...tally, blindClean };
	const w2 = store.walk();
	store.saveWalk({
		...w2,
		lastBaselineDay: today,
		baselineTotals: addBaseline(
			w2.baselineTotals ?? baselineTotalsFromLog(store.recentLog(100_000)),
			baseline,
			now.toISOString(),
		),
	});
	store.log("baseline", { ...baseline });
	return { baseline, usage };
}

/** log.jsonl(新しい順)から、直近に測った基準線を n 回分(新しい順) */
export function recentBaselines(
	log: { event: string; at?: string; [k: string]: unknown }[],
	n = 2,
): (Baseline & { at: string })[] {
	// 本数(docs)は 2026-09-27 から記録している。それより前の記録は docs が無いので undefined のまま
	// にして、「まだ無い」と取り違えない(一度そう表示して、頭が数字が消えたと戸惑った)
	const t = (v: unknown): Tally => {
		const x = (v ?? {}) as Partial<Tally>;
		return {
			hits: x.hits ?? 0,
			total: x.total ?? 0,
			docs: x.docs ?? -1,
			...(x.carried !== undefined ? { carried: x.carried } : {}),
		};
	};
	return log
		.filter((x) => x.event === "baseline")
		.slice(0, n)
		.map((e) => ({
			at: String(e.at ?? ""),
			patterns: (e.patterns as string[]) ?? [],
			external: t(e.external),
			blind: t(e.blind),
			mine: t(e.mine),
			...(e.questions ? { questions: t(e.questions) } : {}),
			...(e.blindQuestions ? { blindQuestions: t(e.blindQuestions) } : {}),
			...(e.blindClean ? { blindClean: t(e.blindClean) } : {}),
		}));
}

export const latestBaseline = (
	log: { event: string; at?: string; [k: string]: unknown }[],
) => recentBaselines(log, 1)[0];
