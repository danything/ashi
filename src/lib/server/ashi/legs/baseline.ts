import type { Head, JsonSchema, Usage } from "../head/head.ts";
import { localDay, type Store } from "../state.ts";

/**
 * 自分の「型」の当たり率の基準線を測る。
 *
 * Ashi は「当たり前に見えるものは誰かの選択だった」のような型を、どの道でも見つける。考古学の話し相手に
 * 多重比較の話を聞いて、その型がどんな文章にも読み込めるなら、見つけたことに意味が無いと気づいた
 * (Ashi の改善案、2026-09-26)。比べる相手を足が用意する。
 *
 * - 1 日 1 回、内省の前に。外の文章(持ち主が渡した材料からランダム)と、Ashi 自身の個性のノートを
 *   どちらか分からないように混ぜて、自己記述を渡さない頭に「この型が当てはまるか」だけを判定させる
 * - 当てはまる割合を外の文章と自分のノートで並べる。外でも同じくらい当てはまるなら、その型は
 *   何にでも読み込めるもので、見つけたこと自体は手がかりにならない
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

export interface Baseline {
	patterns: string[];
	external: { hits: number; total: number };
	mine: { hits: number; total: number };
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
		.map((s) => (store.sourceBody(s.id) ?? "").trim().slice(0, DOC_CHARS))
		.filter((t) => t.length > 200);
	const selfIds = new Set(
		store
			.questions()
			.filter((q) => q.track === "self")
			.map((q) => q.id),
	);
	const mine = store
		.notes()
		.filter((n) => selfIds.has(n.questionId))
		.slice(-PER_SIDE * 3);
	const mineTexts = sample(mine, PER_SIDE, rng)
		.map((n) => (store.noteBody(n.id) ?? "").trim().slice(0, DOC_CHARS))
		.filter((t) => t.length > 200);
	if (external.length < 2 || mineTexts.length < 2) return undefined;

	// どちらの文章か分からないように混ぜて、記号だけを付ける
	const docs = sample(
		[
			...external.map((text) => ({ text, side: "external" as const })),
			...mineTexts.map((text) => ({ text, side: "mine" as const })),
		],
		external.length + mineTexts.length,
		rng,
	).map((d, i) => ({ ...d, label: String.fromCharCode(65 + i) }));

	const prompt = `次の型が、それぞれの文章に当てはまるかを判定してください。

型(この順で applies に並べる):
${patterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}

${docs.map((d) => `<doc id="${d.label}">\n${d.text}\n</doc>`).join("\n\n")}`;

	const { output, usage } = await head.think<{
		results: { doc: string; applies: boolean[] }[];
	}>({ task: "baseline", system: SYSTEM, prompt, schema: SCHEMA });

	const tally = {
		external: { hits: 0, total: 0 },
		mine: { hits: 0, total: 0 },
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

/** log.jsonl(新しい順)から、直近に測った基準線 */
export function latestBaseline(
	log: { event: string; at?: string; [k: string]: unknown }[],
): (Baseline & { at: string }) | undefined {
	const e = log.find((x) => x.event === "baseline");
	if (!e) return undefined;
	return {
		at: String(e.at ?? ""),
		patterns: (e.patterns as string[]) ?? [],
		external: (e.external as Baseline["external"]) ?? { hits: 0, total: 0 },
		mine: (e.mine as Baseline["mine"]) ?? { hits: 0, total: 0 },
	};
}
