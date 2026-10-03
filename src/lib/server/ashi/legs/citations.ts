import type { Store } from "../state.ts";

/**
 * 同じ著者の論文を、ノートごとに違う年や査読の状態で書いているものを候補として出す。
 * Kim と Goodman の研究が、あるノートでは「2025・査読前」、別のノートでは「採録」になっていて、
 * X の訂正に使う直前に気づいた(Ashi の改善案、2026-10-03)。著者名の一致だけなので、別の論文の
 * こともある。どれが正しいか、同じ論文かを決めるのは頭
 */

export interface CitationConflict {
	/** 「Kim・Goodman」「Zorn ら」「Goodman」など */
	authors: string;
	kind: "year" | "status";
	/** 年か状態ごとの、それを書いたノート */
	variants: { label: string; noteIds: string[] }[];
}

/** 年の差がこれより大きいものは、同じ著者の別の論文とみなして出さない */
const MAX_GAP = 3;
const MAX_CONFLICTS = 8;

// 著者(1〜2 人、「ら」「et al.」付き)のあと、句点や改行を挟まず 25 字以内に年
const CITE =
	/([A-Z][a-z][A-Za-z'’-]+)(?:,\s*[A-Z]\.(?:\s*[A-Z]\.)*)?(?:\s*(?:と|・|&|and|,)\s*([A-Z][a-z][A-Za-z'’-]+))?(\s*(?:ら|et al\.?))?[^。\n]{0,25}?\b((?:19|20)\d{2})\b/g;
const UNREVIEWED = /査読前|未査読|プレプリント|preprint|working paper/i;
const PUBLISHED =
	/採録|掲載(?:され|済)|出版され|forthcoming|accepted|published|advance article/i;

type Seen = Map<string, Map<string, Set<string>>>;

function add(seen: Seen, key: string, label: string, noteId: string): void {
	const byLabel = seen.get(key) ?? new Map<string, Set<string>>();
	const ids = byLabel.get(label) ?? new Set<string>();
	ids.add(noteId);
	byLabel.set(label, ids);
	seen.set(key, byLabel);
}

export function citationConflicts(
	notes: { id: string; text: string }[],
): CitationConflict[] {
	const years: Seen = new Map();
	const statuses: Seen = new Map();
	// URL の中の英単語(題名の一部など)を著者と取り違えないよう、先に外す
	const texts = notes.map((n) => ({
		id: n.id,
		lines: n.text.replace(/https?:\/\/\S+/g, " ").split("\n"),
	}));
	// どこかで「著者 年」の形で出た名前だけを著者とみなす
	const authors = new Set<string>();
	for (const n of texts)
		for (const line of n.lines)
			for (const m of line.matchAll(CITE)) {
				if (m[1] && m[4]) authors.add(m[1]);
				if (m[2] && m[4]) authors.add(m[2]);
			}
	for (const n of texts) {
		// 1 本のノートが同じ著者の複数の年を挙げているなら、別々の論文を並べている
		const mine = new Map<string, Set<string>>();
		for (const line of n.lines) {
			for (const m of line.matchAll(CITE)) {
				const [, a, b, etal, y] = m;
				if (!a || !y) continue;
				const key = b ? `${a}・${b}` : etal ? `${a} ら` : a;
				mine.set(key, (mine.get(key) ?? new Set()).add(y));
			}
			// 査読の状態は、著者と同じ段落に書かれた語で見る(1 人ずつ。組の書き方が揺れるため)
			const names = new Set(
				(line.match(/\b[A-Z][a-z][A-Za-z'’-]+\b/g) ?? []).filter((w) =>
					authors.has(w),
				),
			);
			// 両方あるのは「査読前と書いたが、いまは採録」のような書き直しなので、後の状態で数える
			const published = PUBLISHED.test(line);
			if (!published && !UNREVIEWED.test(line)) continue;
			for (const name of names)
				add(statuses, name, published ? "採録・出版" : "査読前", n.id);
		}
		// 年は 2 人の組だけで見る。「Kim ら」「Wang ら」のような 1 人だけだと、同じ姓の別の論文ばかり
		// 拾った(実際のノート 89 本で 9 件、ほぼすべて別の論文)
		for (const [key, ys] of mine)
			if (key.includes("・") && ys.size === 1)
				for (const y of ys) add(years, key, y, n.id);
	}

	const out: CitationConflict[] = [];
	for (const [authors, byYear] of years) {
		const ys = [...byYear.keys()].map(Number).sort((p, q) => p - q);
		const first = ys[0];
		const last = ys[ys.length - 1];
		if (first === undefined || last === undefined) continue;
		if (ys.length < 2 || last - first > MAX_GAP) continue;
		out.push({
			authors,
			kind: "year",
			variants: ys.map((y) => ({
				label: String(y),
				noteIds: [...(byYear.get(String(y)) ?? [])],
			})),
		});
	}
	for (const [author, byStatus] of statuses) {
		const pre = byStatus.get("査読前");
		const pub = byStatus.get("採録・出版");
		if (!pre || !pub) continue;
		// 同じノートの中で書き直しているなら、そのノートは採録の側で数える
		const onlyPre = [...pre].filter((id) => !pub.has(id));
		if (onlyPre.length === 0) continue;
		// 年の食い違いと同じ著者なら、そちらに任せる
		if (out.some((c) => c.authors.split(/・| ら/).includes(author))) continue;
		out.push({
			authors: author,
			kind: "status",
			variants: [
				{ label: "査読前", noteIds: onlyPre },
				{ label: "採録・出版", noteIds: [...pub] },
			],
		});
	}
	return out.slice(0, MAX_CONFLICTS);
}

/** 状態のノート(題・要約・本文)から拾う */
export function noteCitationConflicts(store: Store): CitationConflict[] {
	return citationConflicts(
		store.notes().map((n) => ({
			id: n.id,
			text: `${n.title}\n${n.summary}\n${store.noteBody(n.id) ?? ""}`,
		})),
	);
}
