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
 */

const PER_SIDE = 4;
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
}

function sample<T>(xs: T[], n: number, rng: () => number): T[] {
	const a = [...xs];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j] as T, a[i] as T];
	}
	return a.slice(0, n);
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
			}))
			.filter((t) => t.text.length > 200);
	const mineTexts = texts(
		selfNotes.filter((n) => !n.blind).slice(-PER_SIDE * 3),
	);
	const blindTexts = texts(selfNotes.filter((n) => n.blind));
	if (mineTexts.length < 2 || (blindTexts.length < 1 && external.length < 2))
		return undefined;

	// どれの文章か分からないように混ぜて、記号だけを付ける
	const all = [
		...mineTexts.map((t) => ({ ...t, side: "mine" as const })),
		...blindTexts.map((t) => ({ ...t, side: "blind" as const })),
		...external.map((text) => ({
			text,
			carried: false,
			side: "external" as const,
		})),
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
	const tally = {
		external: zero("external"),
		blind: zero("blind"),
		mine: zero("mine"),
	};
	for (const r of Array.isArray(output.results) ? output.results : []) {
		const d = docs.find((x) => x.label === r.doc);
		if (!d || !Array.isArray(r.applies)) continue;
		const answers = r.applies.slice(0, patterns.length);
		tally[d.side].total += answers.length;
		tally[d.side].hits += answers.filter((x) => x === true).length;
	}
	const baseline: Baseline = { patterns, ...tally };
	store.saveWalk({ ...store.walk(), lastBaselineDay: today });
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
		}));
}

export const latestBaseline = (
	log: { event: string; at?: string; [k: string]: unknown }[],
) => recentBaselines(log, 1)[0];
