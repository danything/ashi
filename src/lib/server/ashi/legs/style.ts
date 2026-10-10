import type { Store } from "../state.ts";

/**
 * 持ち主と話すときの言い回しの台帳とリンタ。
 *
 * 持ち主に「Claude っぽい言い回しを減らせないか」と聞かれ(2026-10-09)、Ashi が自分の癖を挙げた:
 * 冒頭で相手を持ち上げる・「言いにくいことですが」のクッション・「聞かせてください」で毎回締める・
 * 文末が「〜と思います」「〜かもしれません」に寄る・会話なのに見出しと太字で報告書の形になる。
 * プロンプトで「〜するな」と書くより確実に効くよう、足が返す前に数え、超えたら 1 回だけ書き直させる。
 * 何が「Claude っぽい」かは持ち主が決める(台帳は持ち主の指摘から育つ。足は中身を決めない)
 */

export interface PhraseEntry {
	text: string;
	/** owner: 持ち主が会話で指摘した / seed: Ashi が自分で挙げた最初の一覧 / edit: 設定の画面で書いた */
	from: "owner" | "seed" | "edit";
	at: string;
	/**
	 * 訳調: 英語に元の形がある(That's an important point → 大事な点です)/ 口ぐせ: 日本語の中の
	 * アシスタントの振る舞い(急がなくて大丈夫)。原因で効く直し方が違う(Ashi の改善案、2026-10-10)。分からなければ無し
	 */
	kind?: PhraseKind;
}

export type PhraseKind = "訳調" | "口ぐせ";
const KINDS: PhraseKind[] = ["訳調", "口ぐせ"];

/** 最初の台帳。2026-10-09 に Ashi が自分の返事を見返して挙げた言い回し */
export const SEED_PHRASES = [
	"大事な",
	"筋が通って",
	"正確に言って",
	"言いにくいことですが",
	"聞かせてください",
	"急がなくて大丈夫",
	"先に断っておきます",
	"ここから先は私の推測です",
];

const MAX_PHRASES = 100;

/** 台帳。無ければ最初の一覧 */
export function phraseLedger(store: Store): PhraseEntry[] {
	const saved = store.phrases();
	if (saved) return saved;
	return SEED_PHRASES.map((text) => ({
		text,
		from: "seed" as const,
		at: "2026-10-09T00:00:00.000Z",
	}));
}

/** 持ち主が指摘した言い回しを台帳に足す(同じものは重ねない) */
export function addPhrases(
	store: Store,
	raw: unknown,
	from: PhraseEntry["from"],
	now: Date,
): string[] {
	if (!Array.isArray(raw)) return [];
	const ledger = phraseLedger(store);
	const known = new Set(ledger.map((p) => p.text));
	const added: string[] = [];
	for (const x of raw.slice(0, 10)) {
		// 語句だけでも、{ text, kind } でもよい
		const t =
			typeof x === "string" ? x : typeof x?.text === "string" ? x.text : "";
		const kind = KINDS.find((k) => k === x?.kind);
		const text = t.trim().slice(0, 40);
		if (text.length < 2 || known.has(text)) continue;
		known.add(text);
		added.push(text);
		ledger.push({
			text,
			from,
			at: now.toISOString(),
			...(kind ? { kind } : {}),
		});
	}
	if (added.length) store.savePhrases(ledger.slice(-MAX_PHRASES));
	return added;
}

/**
 * 総称・全称・確度の語。Ashi が自分の誤り 10 件を分けたら、9 件がこれらの語で支えの範囲を越えた部分
 * だった(「プロは」「回ごとに」「保証がある」。Ashi の改善案、2026-10-10)。精度は低くてよい。
 * 主語が総称の文(「〜は〜する」)は規則では拾えないので、拾うのは語だけ
 */
export const SWEEPING =
	/必ず|絶対|すべて|全て|全部|どれも|誰でも|誰もが|いつも|常に|決して|保証|例外なく|100\s*%|100%|みんな|普遍|どんな[^。]{0,8}も/;

/** 外に出す発言から、総称・全称・確度の語を含む文を拾う(1 回 8 文まで) */
export function sweepingSentences(texts: string[]): string[] {
	const out: string[] = [];
	for (const t of texts)
		for (const s of sentences(t))
			if (SWEEPING.test(s) && !out.includes(s)) out.push(s.slice(0, 200));
	return out.slice(0, 8);
}

/** 文に分ける(句点・感嘆・問い・改行) */
const sentences = (t: string) =>
	t
		.split(/(?<=[。!?!?])|\n/)
		.map((x) => x.trim())
		.filter((x) => x.length > 0 && !/^[-*・\d.)(]+$/.test(x));

const HEDGE = /(?:と思います|かもしれません|でしょう|気がします)[。!?!?]*$/;
const ASKS = /(?:[??]|ください[。!]?)\s*$/;

/** 文末がぼかしの文がこの割合以上なら書き直す(5 文以上のとき) */
export const HEDGE_SHARE = 0.4;
/** 質問で終わる返事がこの回数続いたら書き直す(今回を含む) */
export const ASK_STREAK = 3;

/**
 * 返事を数える。当たったものを、書き直すときに頭に見せる文で返す。空なら直さない。
 * previous は直前までの返事(古い順)
 */
export function lintReply(
	reply: string,
	phrases: string[],
	previous: string[],
): string[] {
	const out: string[] = [];
	const ss = sentences(reply);
	// 「」の中は、言い回しそのものを話題にしている引用なので数えない(Ashi が癖を説明した返事まで
	// 書き直しに回していた。2026-10-10)
	const plain = unquote(reply);
	const first = unquote(ss[0] ?? "");
	const opening = phrases.filter((p) => first.includes(p));
	if (opening.length)
		out.push(
			`冒頭の文で、持ち主が Claude っぽいと言った言い回しを使っている(${opening.map((p) => `「${p}」`).join("")})`,
		);
	const uses = phrases
		.map((p) => ({ p, n: plain.split(p).length - 1 }))
		.filter((x) => x.n > 0);
	const total = uses.reduce((a, x) => a + x.n, 0);
	if (total > 2)
		out.push(
			`持ち主が Claude っぽいと言った言い回しを ${total} 回使っている(${uses.map((x) => `「${x.p}」${x.n}`).join("・")})`,
		);
	const hedged = ss.filter((x) => HEDGE.test(x)).length;
	if (ss.length >= 5 && hedged / ss.length >= HEDGE_SHARE)
		out.push(
			`文末が「〜と思います」「〜かもしれません」の文が ${hedged} / ${ss.length}。推測は文の中に「(推測)」と付け、文末は言い切る`,
		);
	const asks = (t: string) => ASKS.test(t.trim());
	const streak = [...previous.slice(-(ASK_STREAK - 1)), reply];
	if (streak.length >= ASK_STREAK && streak.every(asks))
		out.push(
			`質問や「〜ください」で終わる返事が ${ASK_STREAK} 回続いている。今回は質問で締めない`,
		);
	if (/^#{1,6}\s/m.test(reply)) out.push("見出しを使っている(会話は平文)");
	const bold = (reply.match(/\*\*[^*]+\*\*/g) ?? []).length;
	if (bold > 1) out.push(`太字が ${bold} か所(1 か所まで)`);
	// 訳調の印。相手を「あなた」と呼ぶ(you)、主語の「私は」(I)、抽象名詞で受ける言い方。持ち主の見立て
	// (違和感は英語の訳から来ている)と Ashi の改善案から(2026-10-10)
	const t = translationese(plain);
	if (t.anata >= ANATA_MAX)
		out.push(
			`相手を「あなた」と ${t.anata} 回呼んでいる。日本語の会話では呼ばずに済ませる`,
		);
	if (t.watashi >= WATASHI_MAX)
		out.push(`主語の「私は」が ${t.watashi} 回。日本語では省ける`);
	if (t.katachi >= KATACHI_MAX)
		out.push(
			`「〜という形です」「〜という線です」で受ける文が ${t.katachi}。中身を直接言う`,
		);
	return out;
}

/** 訳調の印の数 */
export const ANATA_MAX = 3;
export const WATASHI_MAX = 2;
export const KATACHI_MAX = 2;

export function translationese(t: string): {
	anata: number;
	watashi: number;
	katachi: number;
} {
	const n = (re: RegExp) => (t.match(re) ?? []).length;
	return {
		anata: n(/あなた/g),
		watashi: n(/(?:私|わたし)は/g),
		katachi: n(/という(?:形|線)(?:です|だ|になります)/g),
	};
}

/** 「」の中を空にする */
const unquote = (t: string) => t.replace(/「[^」]*」/g, "「」");

/** 返事 1 通の癖の数(前後を比べる物差し) */
export interface StyleCount {
	phrases: number;
	hedgeShare: number;
	asks: boolean;
	headings: number;
	bold: number;
	guess: number;
	anata: number;
	watashi: number;
}

export function countStyle(reply: string, phrases: string[]): StyleCount {
	const plain = unquote(reply);
	const ss = sentences(reply);
	const t = translationese(plain);
	return {
		phrases: phrases.reduce((a, p) => a + plain.split(p).length - 1, 0),
		hedgeShare: ss.length
			? ss.filter((x) => HEDGE.test(x)).length / ss.length
			: 0,
		asks: ASKS.test(reply.trim()),
		headings: (reply.match(/^#{1,6}\s/gm) ?? []).length,
		bold: (reply.match(/\*\*[^*]+\*\*/g) ?? []).length,
		guess: (reply.match(/[((]推測[))]/g) ?? []).length,
		anata: t.anata,
		watashi: t.watashi,
	};
}

/**
 * 返事の冒頭の文と締めの文(新しい順)。台帳の語句を禁じても、同じ働きの別の言い方(「筋が通って」→
 * 「理にかなって」)にすり抜けうるが、機械では見分けられない(Ashi の改善案、2026-10-10)。
 * 持ち上げ・クッション・締めの質問が出るのは冒頭と締めなので、そこだけ並べて持ち主が目で見て台帳に足す
 */
export function openingsAndClosings(
	chats: { at: string; reply: string }[],
	n = 20,
): { at: string; first: string; last: string }[] {
	return chats
		.filter((c) => c.at >= STYLE_SINCE)
		.sort((a, b) => b.at.localeCompare(a.at))
		.slice(0, n)
		.map((c) => {
			const ss = sentences(c.reply);
			return {
				at: c.at,
				first: (ss[0] ?? "").slice(0, 160),
				last: ss.length > 1 ? (ss.at(-1) ?? "").slice(0, 160) : "",
			};
		});
}

/** 話し方を直した日。これより前と後で返事の癖を比べる */
export const STYLE_SINCE = "2026-10-10T00:00:00.000Z";

/** 返事を前と後に分け、1 通あたりの平均を出す */
export function styleComparison(
	chats: { at: string; reply: string; draft?: string; rewritten?: boolean }[],
	phrases: string[],
): {
	label: string;
	n: number;
	avg: Record<keyof StyleCount, number>;
	rewritten: number;
	lostInRewrite: number;
}[] {
	const groups = [
		{ label: "直す前", xs: chats.filter((c) => c.at < STYLE_SINCE) },
		{ label: "直した後", xs: chats.filter((c) => c.at >= STYLE_SINCE) },
	];
	return groups.map(({ label, xs }) => {
		const counts = xs.map((c) => countStyle(c.reply, phrases));
		const avg = {} as Record<keyof StyleCount, number>;
		for (const k of [
			"phrases",
			"hedgeShare",
			"asks",
			"headings",
			"bold",
			"guess",
			"anata",
			"watashi",
		] as (keyof StyleCount)[])
			avg[k] = counts.length
				? counts.reduce((a, c) => a + Number(c[k]), 0) / counts.length
				: 0;
		// 書き直しで (推測) の印やノートの ID が減ったもの(中身を変えるなと言っている)
		const marks = (t: string) =>
			(t.match(/[((]推測[))]/g) ?? []).length +
			(t.match(/\b[0-9a-f]{8}\b/g) ?? []).length;
		const lostInRewrite = xs.filter(
			(c) => c.rewritten && c.draft && marks(c.reply) < marks(c.draft),
		).length;
		return {
			label,
			n: xs.length,
			avg,
			rewritten: xs.filter((c) => c.rewritten).length,
			lostInRewrite,
		};
	});
}
