import type { Config } from "../config.ts";
import {
	type Budget,
	type Note,
	newId,
	type Proposal,
	type Question,
	type Store,
} from "../state.ts";
import { score } from "./select.ts";

/**
 * ガードレール。頭が何を言っても、ここを通したものだけが状態に残る。
 * 頭の判断よりこちらが常に勝つ。
 */

/** 頭の数値の見立てを 0〜1 に。数でなければ真ん中 */
export const unit = (v: unknown): number =>
	typeof v === "number" && Number.isFinite(v)
		? Math.min(1, Math.max(0, v))
		: 0.5;

/** 休む時間(分)を設定の範囲に丸める。頭が何も言わなければ下限 */
export function clampSleep(
	minutes: unknown,
	cfg: Pick<Config, "sleep">,
): number {
	const m =
		typeof minutes === "number" && Number.isFinite(minutes)
			? minutes
			: cfg.sleep.minMinutes;
	return Math.min(
		cfg.sleep.maxMinutes,
		Math.max(cfg.sleep.minMinutes, Math.round(m)),
	);
}

/** テーマは短い名前に揃える(表記ゆれで連続の制限をすり抜けないよう、空白と大文字小文字を畳む) */
export function normalizeTheme(t: unknown): string {
	const s =
		typeof t === "string"
			? t.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
			: "";
	return s.slice(0, 40) || "その他";
}

const normalizeText = (t: string) =>
	t.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

export interface RawQuestion {
	text?: unknown;
	theme?: unknown;
	interest?: unknown;
	importance?: unknown;
	feasibility?: unknown;
	track?: unknown;
}

/** 日本語の短い文の近さ。文字 bigram の Jaccard 係数(記号と空白は除く) */
export function bigrams(text: string): Set<string> {
	const t = text
		.normalize("NFKC")
		.replace(/[\s\p{P}\p{S}]/gu, "")
		.toLowerCase();
	const out = new Set<string>();
	for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
	return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
	let n = 0;
	for (const x of a) if (b.has(x)) n++;
	return n / (a.size + b.size - n || 1);
}

/**
 * これ以上近ければ、ほぼ同じ問いとして受け取らない。2026-09-25 の実際の問い(45 本)で測ると、
 * 言い換えの重複は 0.25〜0.49、話題は同じでも別の問い(定義か効果か)が 0.33〜0.41 と重なっていた。
 * 足がはじくのは明らかなものだけにして、その下は内省で頭に統合の候補として見せる(similarPairs)
 */
export const NEAR_DUPLICATE = 0.45;
export const SIMILAR = 0.25;

export interface QuestionFrom {
	source: NonNullable<Question["source"]>;
	via?: string;
}

/**
 * 頭が出した新しい問いのうち、形が正しく、重複しないものを上限まで。
 * - 文字がほぼ同じ問い(NEAR_DUPLICATE 以上)は受け取らず、既存の問いの echoes を足す。
 *   比べる相手は開いた問いだけでなく、統合で手放した問い(統合先の echoes を足す)・答えた問い・
 *   未測定の棚の問いも(言い換えるだけで、内省でまとめた分や閉じた問いが開き直っていた。Ashi の指摘、2026-09-25)。
 *   点数の低さで手放しただけの問い(mergedInto の無い dropped)は比べない。また出てきたなら、もう一度歩く価値がある
 * - テーマの開いた問いが maxOpenPerTheme に達していたら受け取らない。見たことのないテーマ名でも、
 *   近い(SIMILAR 以上の)開いた問いがあれば、そのテーマの問いとして数えて名前も揃える(新しい名前で上限を抜けていた)
 */
export function acceptNewQuestions(
	raw: RawQuestion[] | undefined,
	existing: Question[],
	cfg: Pick<Config, "maxNewQuestions"> &
		Partial<Pick<Config, "maxOpenPerTheme">>,
	parentId: string | undefined,
	now: Date,
	from?: QuestionFrom,
): Question[] {
	const seen = new Set(existing.map((q) => normalizeText(q.text)));
	const byId = new Map(existing.map((q) => [q.id, q]));
	const open = existing.filter((q) => q.status === "open");
	const grams = open.map((q) => ({ q, g: bigrams(q.text) }));
	const closed = existing
		.filter(
			(q) =>
				q.status === "answered" ||
				q.status === "parked" ||
				(q.status === "dropped" && q.mergedInto),
		)
		.map((q) => ({ q, g: bigrams(q.text) }));
	const perTheme = new Map<string, number>();
	for (const q of open) perTheme.set(q.theme, (perTheme.get(q.theme) ?? 0) + 1);
	const out: Question[] = [];
	for (const r of raw ?? []) {
		if (out.length >= cfg.maxNewQuestions) break;
		if (typeof r?.text !== "string") continue;
		const text = r.text.trim().slice(0, 300);
		const key = normalizeText(text);
		if (!key || seen.has(key)) continue;
		const g = bigrams(text);
		const twin =
			grams.find((x) => jaccard(g, x.g) >= NEAR_DUPLICATE) ??
			closed.find((x) => jaccard(g, x.g) >= NEAR_DUPLICATE);
		if (twin) {
			// 同じ問いがまた出た。受け取らず、数だけ足す。統合で手放した問いなら統合先に
			const into = mergedTarget(twin.q, byId);
			into.echoes = (into.echoes ?? 0) + 1;
			continue;
		}
		let theme = normalizeTheme(r.theme);
		if (!perTheme.has(theme)) {
			const near = grams
				.map((x) => ({ x, v: jaccard(g, x.g) }))
				.filter((o) => o.v >= SIMILAR && o.x.q.status === "open")
				.sort((a, b) => b.v - a.v)[0];
			if (near) theme = near.x.q.theme;
		}
		if (
			cfg.maxOpenPerTheme &&
			(perTheme.get(theme) ?? 0) >= cfg.maxOpenPerTheme
		)
			continue;
		seen.add(key);
		perTheme.set(theme, (perTheme.get(theme) ?? 0) + 1);
		const q: Question = {
			id: newId(),
			text,
			theme,
			track: r.track === "owner" ? "owner" : "self",
			interest: unit(r.interest),
			importance: unit(r.importance),
			feasibility: unit(r.feasibility),
			status: "open",
			visits: 0,
			createdAt: now.toISOString(),
			parentId,
			...(from
				? { source: from.source, ...(from.via ? { via: from.via } : {}) }
				: {}),
		};
		grams.push({ q, g });
		out.push(q);
	}
	return out;
}

/** 統合で手放した問いの行き先をたどる(統合先がさらに統合されていることがある) */
function mergedTarget(q: Question, byId: Map<string, Question>): Question {
	let cur = q;
	const visited = new Set<string>();
	while (cur.mergedInto && !visited.has(cur.id)) {
		visited.add(cur.id);
		const next = byId.get(cur.mergedInto);
		if (!next) break;
		cur = next;
	}
	return cur;
}

/** 近い問いの組(統合の候補)。同じ系統の開いた問いで、SIMILAR 以上 NEAR_DUPLICATE 未満。近い順 */
export function similarPairs(
	qs: Question[],
	limit = 12,
): [Question, Question, number][] {
	const open = qs
		.filter((q) => q.status === "open")
		.map((q) => ({ q, g: bigrams(q.text) }));
	const pairs: [Question, Question, number][] = [];
	for (let i = 0; i < open.length; i++) {
		for (let j = i + 1; j < open.length; j++) {
			const a = open[i];
			const b = open[j];
			if (!a || !b || a.q.track !== b.q.track) continue;
			const v = jaccard(a.g, b.g);
			if (v >= SIMILAR) pairs.push([a.q, b.q, v]);
		}
	}
	return pairs.sort((x, y) => y[2] - x[2]).slice(0, limit);
}

export interface MergeDraft {
	keep?: unknown;
	drop?: unknown;
	theme?: unknown;
}

export interface ThemeRenameDraft {
	from?: unknown;
	to?: unknown;
}

/**
 * 内省で頭が決めた統合を、足が状態に当てる。keep と drop は開いた問いの ID でなければ無視する。
 * drop は手放し(mergedInto に keep)、keep のテーマを揃える。themes はテーマの名前をまとめて付け替える
 */
export function applyMerges(
	qs: Question[],
	merges: unknown,
	themes: unknown,
): {
	questions: Question[];
	merged: number;
	renamed: number;
	/** テーマの付け替え(古い名前 → 新しい名前)。歩いたテーマの記録(recentThemes)にも当てる */
	renames: Map<string, string>;
} {
	const byId = new Map(qs.map((q) => [q.id, { ...q }]));
	const renames = new Map<string, string>();
	let merged = 0;
	let renamed = 0;
	for (const m of (Array.isArray(merges) ? merges : []).slice(
		0,
		10,
	) as MergeDraft[]) {
		const keep = typeof m?.keep === "string" ? byId.get(m.keep) : undefined;
		if (!keep) continue;
		if (keep.status !== "open") continue;
		for (const id of (Array.isArray(m.drop) ? m.drop : []).slice(0, 20)) {
			const d = typeof id === "string" ? byId.get(id) : undefined;
			if (!d || d.id === keep.id || d.status !== "open") continue;
			d.status = "dropped";
			d.mergedInto = keep.id;
			keep.echoes = (keep.echoes ?? 0) + 1 + (d.echoes ?? 0);
			merged++;
		}
		if (typeof m.theme === "string" && m.theme.trim())
			keep.theme = normalizeTheme(m.theme);
	}
	for (const t of (Array.isArray(themes) ? themes : []).slice(
		0,
		10,
	) as ThemeRenameDraft[]) {
		if (typeof t?.to !== "string" || !t.to.trim() || !Array.isArray(t.from))
			continue;
		const to = normalizeTheme(t.to);
		const from = new Set(
			t.from
				.filter((x): x is string => typeof x === "string")
				.map(normalizeTheme),
		);
		for (const f of from) if (f !== to) renames.set(f, to);
		for (const q of byId.values()) {
			if (q.status === "open" && from.has(q.theme) && q.theme !== to) {
				q.theme = to;
				renamed++;
			}
		}
	}
	return {
		questions: qs.map((q) => byId.get(q.id) ?? q),
		merged,
		renamed,
		renames,
	};
}

/**
 * 個性(self)の開いた問いのうち、持ち主から生まれたものの割合。LLM を使わない機械的な数字。
 * 親をたどり、途中に先回り(owner)の問いがあるか、根が持ち主の地図・持ち主との対話・X での持ち主との
 * 会話なら「持ち主から」。親を 1 代しか見ておらず、孫の世代で増えた群を数え落としていた(Ashi の指摘、2026-09-25)。
 * 根が問い探し(seed)のものは「分からない」に数える。問い探しでも頭は持ち主の地図を丸ごと見ているので、
 * 持ち主と無関係とは言えない。出どころの記録が無いものも「分からない」
 */
export function ownerPull(
	qs: Question[],
	ownerHandles: string[],
): { fromOwner: number; known: number; total: number } {
	const byId = new Map(qs.map((q) => [q.id, q]));
	const handles = new Set(ownerHandles.map((h) => h.toLowerCase()));
	const self = qs.filter((q) => q.status === "open" && q.track === "self");
	let fromOwner = 0;
	let known = 0;
	for (const q of self) {
		const r = lineage(q, byId, handles);
		if (r === "unknown") continue;
		known++;
		if (r === "owner") fromOwner++;
	}
	return { fromOwner, known, total: self.length };
}

/**
 * よそ者から来た問いが、どこに着地したか。
 * - home: 持ち主由来のテーマ(先回りの問いか、親をたどると持ち主に行き着く問いがあるテーマ)。
 *   出どころだけ見て「外」と数えると、頭が相手の話を持ち主の関心へ引き戻していても見えない
 *   (Ashi の指摘、2026-09-25)
 * - own: 持ち主由来ではないが、その問いより前からあった自分(self)のテーマ。持ち主ではなく
 *   自分の型に引き戻している(鉄道の話し相手から出た問いが 2 本とも前からのテーマに入った。
 *   Ashi の改善案、2026-09-26)
 * - 残り(total - home - own)が、よそ者が本当に新しく持ち込んだテーマ
 * テーマは受け取るときに近い問いのテーマへ揃えるので(acceptNewQuestions)、引き戻されたものは既存のテーマに入る
 */
export function strangerLanding(
	qs: Question[],
	ownerHandles: string[],
): { home: number; own: number; total: number } {
	const byId = new Map(qs.map((q) => [q.id, q]));
	const handles = new Set(ownerHandles.map((h) => h.toLowerCase()));
	const rooted = new Set(
		qs
			.filter(
				(q) =>
					q.source !== "stranger" &&
					!q.mergedInto &&
					(q.track === "owner" || lineage(q, byId, handles) === "owner"),
			)
			.map((q) => q.theme),
	);
	/** テーマごとに、よそ者以外の self の問いがいちばん早く現れた時刻 */
	const selfSince = new Map<string, string>();
	for (const q of qs) {
		if (q.source === "stranger" || q.track !== "self" || q.mergedInto) continue;
		const had = selfSince.get(q.theme);
		if (!had || q.createdAt < had) selfSince.set(q.theme, q.createdAt);
	}
	const s = qs.filter((q) => q.source === "stranger" && !q.mergedInto);
	let home = 0;
	let own = 0;
	for (const q of s) {
		if (rooted.has(q.theme)) home++;
		else {
			const since = selfSince.get(q.theme);
			if (since && since < q.createdAt) own++;
		}
	}
	return { home, own, total: s.length };
}

/** 自己記述を渡さずに歩いた個性のノートと、渡して歩いた個性のノートを数件ずつ(新しい順) */
export function blindComparison(
	notes: Note[],
	qs: Question[],
	n = 4,
): { blind: Note[]; sighted: Note[] } {
	const track = new Map(qs.map((q) => [q.id, q.track]));
	const self = notes.filter((x) => track.get(x.questionId) === "self");
	return {
		blind: self
			.filter((x) => x.blind)
			.slice(-n)
			.reverse(),
		sighted: self
			.filter((x) => !x.blind)
			.slice(-n)
			.reverse(),
	};
}

/** ぼかし(手探り)の言い方と、言い切りの言い方。まずは単純な語のリスト(Ashi の案。良い基準は分かっていない) */
const HEDGES = [
	"らしい",
	"と思う",
	"かもしれない",
	"たぶん",
	"おそらく",
	"ようだ",
	"ように見える",
	"だろう",
	"気がする",
	"はず",
	"のではないか",
	"可能性",
];
const ASSERTS = [
	"必ず",
	"決して",
	"明らかに",
	"違いない",
	"間違いなく",
	"確かに",
	"常に",
];

const countWords = (text: string, words: string[]) =>
	words.reduce((n, w) => n + text.split(w).length - 1, 0);

/**
 * 自己記述の 1 版のぼかしと言い切りの数。LLM は書き直すたびにぼかしを削って言い切りへ寄ると
 * 報告されている(伝言ゲームの研究)ので、版ごとに並べて内省に見せる(Ashi の改善案、2026-09-26)
 */
export function hedgeStats(text: string): {
	sentences: number;
	hedges: number;
	asserts: number;
} {
	const sentences = text
		.split(/[。!?\n]/)
		.filter((x) => x.trim().length > 4).length;
	return {
		sentences,
		hedges: countWords(text, HEDGES),
		asserts: countWords(text, ASSERTS),
	};
}

/** 自己記述の版から、最初の版と、直近 12 版のぼかし・言い切りの数(古い順) */
export function selfEvolution(history: { at: string; text: string }[]): {
	first?: { at: string; text: string };
	versions: {
		at: string;
		sentences: number;
		hedges: number;
		asserts: number;
	}[];
} {
	return {
		first: history[0],
		versions: history
			.slice(-12)
			.map((v) => ({ at: v.at, ...hedgeStats(v.text) })),
	};
}

/** 内省で頭が挙げた、自分の型の言葉や短い句。8 個まで、1 個 40 字まで */
export function acceptPatterns(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return [
		...new Set(
			v
				.filter((x): x is string => typeof x === "string" && x.trim() !== "")
				.map((x) => x.trim().slice(0, 40)),
		),
	].slice(0, 8);
}

/**
 * よそ者との会話で、自分の型の言葉が Ashi の最初の返事に出たか、相手がそれより先に言ったか。
 * 語の一致だけの粗い目安(Ashi の案)
 */
export function patternHits(
	turns: { by: "stranger" | "ashi"; text: string }[],
	patterns: string[],
): { word: string; firstReply: boolean; strangerFirst: boolean }[] {
	const first = turns.findIndex((t) => t.by === "ashi");
	if (first < 0) return [];
	const before = turns
		.slice(0, first)
		.filter((t) => t.by === "stranger")
		.map((t) => t.text)
		.join("\n");
	const reply = turns[first]?.text ?? "";
	return patterns
		.map((word) => ({
			word,
			firstReply: reply.includes(word),
			strangerFirst: before.includes(word),
		}))
		.filter((p) => p.firstReply);
}

/** 文の中の問い ID(8 桁の 16 進) */
export const questionIds = (s: string): string[] =>
	s.match(/\b[0-9a-f]{8}\b/g) ?? [];

/**
 * 内省の次の一歩に書かれた問いに、続けて書かれた回数を付ける。書かれなくなったら消す
 */
export function markPromised(qs: Question[], intentions: string[]): Question[] {
	const ids = new Set(intentions.flatMap(questionIds));
	return qs.map((q) => {
		if (ids.has(q.id)) return { ...q, promised: (q.promised ?? 0) + 1 };
		if (q.promised) {
			const { promised: _, ...rest } = q;
			return rest;
		}
		return q;
	});
}

/**
 * 次の一歩に書いたのに歩かれなかった問いが、なぜ歩かれなかったか。推測でなく状態から言う
 * (選ばれなかったのか、閉じたのか、統合されたのか、上限で手放されたのか。Ashi の改善案、2026-09-26)
 */
export function missedPromises(
	ids: string[],
	qs: Question[],
	resting: string[],
): { id: string; why: string }[] {
	const byId = new Map(qs.map((q) => [q.id, q]));
	return ids.map((id) => {
		const q = byId.get(id);
		if (!q) return { id, why: "一覧に無い(ID の書き違いか、リセット前の問い)" };
		if (q.status === "answered") return { id, why: "答えが出て閉じた" };
		if (q.status === "parked")
			return { id, why: "見つからないまま未測定の棚に移った" };
		if (q.status === "dropped")
			return {
				id,
				why: q.mergedInto
					? `内省で統合された → [${q.mergedInto}]`
					: "開いた問いの上限で、点数が低いものとして手放された",
			};
		const same = qs
			.filter((x) => x.status === "open" && x.track === q.track)
			.sort((a, b) => score(b) - score(a));
		const rank = same.findIndex((x) => x.id === id) + 1;
		const reasons = [
			`${q.track === "owner" ? "先回り" : "個性"}の系統の中で点数 ${rank} 位 / ${same.length} 本`,
		];
		if (resting.includes(q.theme))
			reasons.push(`テーマ「${q.theme}」を休ませていた`);
		return { id, why: `開いたまま選ばれなかった(${reasons.join("、")})` };
	});
}

/** 外で確かめずに言ったこと。1 回 8 件まで、1 件 200 字まで(3 件で切って取りこぼしていた) */
export function acceptClaims(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v
		.filter((x): x is string => typeof x === "string" && x.trim() !== "")
		.slice(0, CLAIMS_MAX)
		.map((x) => x.trim().slice(0, 200));
}

const CLAIMS_MAX = 8;

/** 自分で付けた「確かめていない」の印 */
const UNVERIFIED_MARKS = [
	"記憶だけ",
	"記憶で言",
	"記憶頼み",
	"記憶の印象",
	"うろ覚え",
	"確かめていない",
	"確かめてない",
	"確かめられていない",
	"未確認",
	"たしか",
];

/**
 * 発言の中から、自分で「確かめていない」の印を付けた文を抜き出す。頭の申告(unverified)だけに頼ると、
 * 会話で 3 つ言ったのに 1 つしか積まれないことがあった(Ashi の改善案、2026-09-27)。足でも拾う
 */
export function markedClaims(texts: string[]): string[] {
	const out: string[] = [];
	for (const t of texts) {
		for (const s of t.split(/(?<=[。!?!?])|\n/)) {
			const x = s.trim();
			if (x.length >= 8 && UNVERIFIED_MARKS.some((m) => x.includes(m)))
				out.push(x.slice(0, 200));
		}
	}
	return [...new Set(out)].slice(0, CLAIMS_MAX);
}

/** 頭の申告と足が拾ったものを合わせる(ほぼ同じ文は 1 つに) */
export function mergeClaims(declared: string[], marked: string[]): string[] {
	const out = [...declared];
	for (const m of marked) {
		const g = bigrams(m);
		if (!out.some((d) => jaccard(g, bigrams(d)) >= SIMILAR)) out.push(m);
	}
	return out.slice(0, CLAIMS_MAX);
}

/** 確かめずに言ったことを、確かめる問いの形にする。where は「X で @誰々 さんに」など */
export function claimQuestions(claims: string[], where: string): RawQuestion[] {
	return claims.map((claim) => ({
		text: `「${claim}」は本当か(${where}言ったこと)`,
		theme: "確かめること",
		track: "self",
		interest: 0.7,
		importance: 0.9,
		feasibility: 0.8,
	}));
}

/**
 * 前回の内省からの足どり。次の一歩(intentions)に書いた問い ID と照らし、約束を守れたかを
 * 推測でなく記録で振り返らせる(Ashi の改善案、2026-09-26)。log は新しい順
 */
export function walkTrail(
	log: { event: string; [k: string]: unknown }[],
	intentions: string[],
): {
	steps: {
		questionId?: string;
		question: string;
		theme: string;
		result: "note" | "none" | "parked";
		promised: boolean;
	}[];
	promised: string[];
	kept: string[];
	unmatched: number;
} {
	const since: typeof log = [];
	for (const e of log) {
		if (e.event === "reflected" || e.event === "reset") break;
		since.push(e);
	}
	const promised = [...new Set(intentions.flatMap(questionIds))];
	const steps = since
		.filter((e) => e.event === "walked")
		.reverse()
		.map((e) => {
			const questionId =
				typeof e.questionId === "string" ? e.questionId : undefined;
			return {
				questionId,
				question: String(e.question ?? ""),
				theme: String(e.theme ?? ""),
				result: (e.parked ? "parked" : e.found === "none" ? "none" : "note") as
					| "note"
					| "none"
					| "parked",
				promised: Boolean(questionId && promised.includes(questionId)),
			};
		});
	const walked = new Set(steps.map((s) => s.questionId).filter(Boolean));
	return {
		steps,
		promised,
		kept: promised.filter((id) => walked.has(id)),
		unmatched: intentions.filter((i) => questionIds(i).length === 0).length,
	};
}

function lineage(
	q: Question,
	byId: Map<string, Question>,
	handles: Set<string>,
): "owner" | "other" | "unknown" {
	const visited = new Set<string>();
	let cur: Question | undefined = q;
	while (cur && !visited.has(cur.id)) {
		visited.add(cur.id);
		if (cur !== q && cur.track === "owner") return "owner";
		const parent: Question | undefined = cur.parentId
			? byId.get(cur.parentId)
			: undefined;
		if (!parent) break;
		cur = parent;
	}
	// 根(親をたどり切った問い)の出どころ
	const root = cur ?? q;
	if (root.parentId && byId.has(root.parentId)) return "unknown"; // 循環
	if (root.source === "profile" || root.source === "chat") return "owner";
	if (root.source === "x") {
		const viaOwner = root.via
			?.split(",")
			.some((v) => handles.has(v.trim().toLowerCase()));
		return viaOwner ? "owner" : "other";
	}
	// よそ者(別のモデル)との対話から生まれたもの。持ち主の関心の外から来た
	if (root.source === "stranger") return "other";
	if (root.source === "seed" || !root.source) return "unknown";
	// 歩いて生まれたのに親が残っていない(リセット前の親など)
	return "unknown";
}

const TRIGGERS = ["owner", "x", "stranger", "reading", "own"] as const;
const BASES = ["evidence", "pushback"] as const;

export interface SelfChange {
	what: string;
	trigger: (typeof TRIGGERS)[number];
	basis: (typeof BASES)[number];
}

/** 内省で頭が申告した、自己記述を変えたきっかけ。形の正しいものを 5 件まで */
export function acceptSelfChanges(v: unknown): SelfChange[] {
	if (!Array.isArray(v)) return [];
	const out: SelfChange[] = [];
	for (const c of v.slice(0, 5)) {
		const what = typeof c?.what === "string" ? c.what.trim().slice(0, 300) : "";
		if (
			what &&
			(TRIGGERS as readonly string[]).includes(c.trigger) &&
			(BASES as readonly string[]).includes(c.basis)
		)
			out.push({ what, trigger: c.trigger, basis: c.basis });
	}
	return out;
}

/** 対話で頭が取った立場。新しいものを先頭に、20 件まで残す */
export function addStances(
	prev: { at: string; text: string }[] | undefined,
	v: unknown,
	now: Date,
): { at: string; text: string }[] {
	const fresh = (Array.isArray(v) ? v : [])
		.filter((x): x is string => typeof x === "string" && x.trim() !== "")
		.slice(0, 3)
		.map((text) => ({
			at: now.toISOString(),
			text: text.trim().slice(0, 300),
		}));
	return [...fresh, ...(prev ?? [])].slice(0, 20);
}

/** 抱えている問いが多すぎたら、点の低いものから手放す */
export function trimOpenQuestions(
	qs: Question[],
	cfg: Pick<Config, "maxOpenQuestions">,
): Question[] {
	// 次の一歩に書かれている問いは手放さない(点数が低くても、頭が歩くと約束したもの)
	const open = qs
		.filter((q) => q.status === "open")
		.sort(
			(a, b) =>
				Number(Boolean(b.promised)) - Number(Boolean(a.promised)) ||
				score(b) - score(a),
		);
	const drop = new Set(open.slice(cfg.maxOpenQuestions).map((q) => q.id));
	if (drop.size === 0) return qs;
	return qs.map((q) => (drop.has(q.id) ? { ...q, status: "dropped" } : q));
}

const SELF_MAX = 4000;

/** 自己記述・持ち主の地図の書き直し。空や長すぎるものは受け取らない */
export function acceptSelf(text: unknown, max = SELF_MAX): string | undefined {
	if (typeof text !== "string") return undefined;
	const s = text.trim();
	if (s.length < 20 || s.length > max) return undefined;
	return `${s}\n`;
}

/** この 1 歩で使ってよい額。0 なら歩かない */
export function allowance(b: Budget, cfg: Pick<Config, "budget">): number {
	return Math.max(
		0,
		Math.min(cfg.budget.stepUsd, cfg.budget.dailyUsd - b.spentUsd),
	);
}

/** 次のローカル時刻 0 時(予算が戻る時刻) */
export function nextMidnight(now: Date): Date {
	const d = new Date(now);
	d.setHours(24, 0, 0, 0);
	return d;
}

const normTitle = (t: string) =>
	t.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/**
 * 内省で出た改善案を受け取る。1 回 3 件まで、長さを切り、同じ題の案(未処理)は数を足すだけにする。
 * 見送った案と同じ題がまた出たら、もう一度開く(また困っているので)
 */
export function acceptProposals(
	raw: unknown,
	existing: Proposal[],
	now: Date,
): { proposals: Proposal[]; added: string[] } {
	const list = Array.isArray(raw) ? raw : [];
	const out = existing.map((p) => ({ ...p }));
	const added: string[] = [];
	for (const r of list.slice(0, 3) as Partial<
		Record<"title" | "why" | "idea", unknown>
	>[]) {
		if (typeof r?.title !== "string" || !r.title.trim()) continue;
		const title = r.title.trim().slice(0, 120);
		const why = String(r.why ?? "")
			.trim()
			.slice(0, 2000);
		const idea = String(r.idea ?? "")
			.trim()
			.slice(0, 2000);
		const same = out.find(
			(p) => normTitle(p.title) === normTitle(title) && p.status !== "filed",
		);
		if (same) {
			same.count += 1;
			same.lastAt = now.toISOString();
			if (same.status === "dismissed") same.status = "open";
			if (why) same.why = why;
			if (idea) same.idea = idea;
			continue;
		}
		out.push({
			id: newId(),
			title,
			why,
			idea,
			status: "open",
			count: 1,
			createdAt: now.toISOString(),
			lastAt: now.toISOString(),
		});
		added.push(title);
	}
	return { proposals: out, added };
}

/** 内省の「次の一歩」。3 件まで、1 件 300 字まで */
export function acceptIntentions(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((x): x is string => typeof x === "string" && x.trim() !== "")
		.slice(0, 3)
		.map((x) => x.trim().slice(0, 300));
}

/** 探した場所。1 歩 10 件まで、1 件 200 字まで */
export function acceptSearched(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((x): x is string => typeof x === "string" && x.trim() !== "")
		.slice(0, 10)
		.map((x) => x.trim().slice(0, 200));
}

const BRIDGES_MAX = 30;

/** 橋の候補を足す。1 回 3 件まで、同じ見方は重ねず、古いものから捨てて 30 件に保つ */
export function addBridgeIdeas(
	store: Store,
	raw: unknown,
	fromNoteId: string | undefined,
	now: Date,
): void {
	if (!Array.isArray(raw) || raw.length === 0) return;
	const list = store.bridgeIdeas();
	const seen = new Set(list.map((b) => normTitle(b.idea)));
	for (const r of raw.slice(0, 3) as Partial<
		Record<"to_theme" | "idea", unknown>
	>[]) {
		if (typeof r?.idea !== "string" || !r.idea.trim()) continue;
		const idea = r.idea.trim().slice(0, 400);
		if (seen.has(normTitle(idea))) continue;
		seen.add(normTitle(idea));
		list.push({
			id: newId(),
			fromNoteId,
			toTheme: normalizeTheme(r.to_theme),
			idea,
			createdAt: now.toISOString(),
		});
	}
	store.saveBridgeIdeas(list.slice(-BRIDGES_MAX));
}

/** 持ち主の X のハンドル(足跡に登録した X のアカウント)。X で持ち主と話したかの判定に使う */
export function ownerHandles(cfg: Pick<Config, "feeds">): string[] {
	return cfg.feeds
		.filter((f) => f.kind === "x")
		.map((f) => f.target.replace(/^@/, ""));
}
