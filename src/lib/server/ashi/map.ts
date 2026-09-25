import { bigrams, jaccard } from "./legs/guard.ts";
import type { BridgeIdea, Note, Question } from "./state.ts";

/**
 * 思考のつながりの地図(/map の 3D グラフ)の材料。足が持っている記録だけから組む。
 *
 * 人の頭の中の「連想」に近いものとして、Ashi が実際に持っているつながりを線にする。
 *   parent:  歩いていてこの問いが生まれた(parentId)
 *   bridge:  個性の問いから先回りの問いへ持ち帰った(親が self の owner の問い)
 *   note:    問いを歩いてノートを書いた
 *   merged:  内省で統合した(mergedInto)
 *   origin:  どこから生まれたか(持ち主との対話・X の会話・持ち主の地図・問い探し)
 *   idea:    ノートから思いついた橋の候補と、その持ち込み先のテーマ
 *   near:    文字の近さ(bigram の Jaccard)。頭が意識して結んだものではない、ゆるい連想
 * テーマは点にせず色分けとまとまりにだけ使う(点にすると全部がテーマに吸い寄せられて、連想が見えなくなった)
 */

export type MapNodeKind = "question" | "note" | "origin" | "idea" | "owner";
export type MapLinkKind =
	| "parent"
	| "bridge"
	| "note"
	| "merged"
	| "origin"
	| "idea"
	| "near";

export interface MapNode {
	id: string;
	kind: MapNodeKind;
	label: string;
	/** 画面で開く先 */
	href?: string;
	track?: "owner" | "self";
	status?: string;
	theme?: string;
	/** 大きさ(歩いた回数など) */
	weight: number;
	/** 生まれた時刻。時間を巻き戻して育ち方を見るのに使う */
	at: string;
}

export interface MapLink {
	source: string;
	target: string;
	kind: MapLinkKind;
	/** near のときの近さ */
	strength?: number;
	at: string;
}

export interface ThoughtMap {
	nodes: MapNode[];
	links: MapLink[];
	themes: string[];
}

/** near の線を引く近さ。統合の候補(0.25)より少し上にして、線を減らす */
export const NEAR = 0.3;

const ORIGIN_LABEL: Record<string, string> = {
	chat: "持ち主との対話",
	profile: "持ち主の地図",
	seed: "問い探し",
};

const later = (a: string, b: string) => (a > b ? a : b);

export function buildThoughtMap(
	questions: Question[],
	notes: Note[],
	bridges: BridgeIdea[],
	ownerHandles: string[] = [],
): ThoughtMap {
	const nodes = new Map<string, MapNode>();
	const links: MapLink[] = [];
	const byId = new Map(questions.map((q) => [q.id, q]));
	const handles = new Set(ownerHandles.map((h) => h.toLowerCase()));

	const ensure = (n: MapNode) => {
		const had = nodes.get(n.id);
		// 同じ出どころの点は、いちばん早く現れた時刻にする
		if (!had) nodes.set(n.id, n);
		else if (n.at < had.at) had.at = n.at;
		return nodes.get(n.id) as MapNode;
	};
	let owner: MapNode | undefined;
	const ownerNode = (at: string) => {
		owner = ensure({
			id: "owner",
			kind: "owner",
			label: "持ち主",
			href: "/owner",
			weight: 3,
			at,
		});
		return owner;
	};

	for (const q of questions) {
		ensure({
			id: `q:${q.id}`,
			kind: "question",
			label: q.text,
			href: "/questions",
			track: q.track,
			status: q.status,
			theme: q.theme,
			weight: 1 + (q.visits ?? 0) + (q.echoes ?? 0) * 0.5,
			at: q.createdAt,
		});
	}

	for (const q of questions) {
		const parent = q.parentId ? byId.get(q.parentId) : undefined;
		if (parent)
			links.push({
				source: `q:${parent.id}`,
				target: `q:${q.id}`,
				kind:
					parent.track === "self" && q.track === "owner" ? "bridge" : "parent",
				at: q.createdAt,
			});
		const into = q.mergedInto ? byId.get(q.mergedInto) : undefined;
		if (into)
			links.push({
				source: `q:${q.id}`,
				target: `q:${into.id}`,
				kind: "merged",
				at: later(q.createdAt, into.createdAt),
			});
		// 歩いて生まれた問いは親の線があるので、出どころの点は要らない
		if (parent || !q.source || q.source === "explore") continue;
		let originId: string;
		let label: string;
		let fromOwner = q.source === "chat" || q.source === "profile";
		if (q.source === "x") {
			const who = (q.via ?? "?").split(",")[0]?.trim() || "?";
			fromOwner = handles.has(who.toLowerCase());
			originId = `o:x:${who.toLowerCase()}`;
			label = `X の会話 @${who}`;
		} else {
			originId = `o:${q.source}`;
			label = ORIGIN_LABEL[q.source] ?? q.source;
		}
		ensure({
			id: originId,
			kind: "origin",
			label,
			href: q.source === "x" ? "/x" : q.source === "chat" ? "/chat" : undefined,
			weight: 2,
			at: q.createdAt,
		});
		links.push({
			source: originId,
			target: `q:${q.id}`,
			kind: "origin",
			at: q.createdAt,
		});
		if (fromOwner) {
			const o = ownerNode(q.createdAt);
			if (!links.some((l) => l.source === o.id && l.target === originId))
				links.push({
					source: o.id,
					target: originId,
					kind: "origin",
					at: q.createdAt,
				});
		}
	}
	// 持ち主の点と出どころの線は、いちばん早い時刻に揃える
	if (owner)
		for (const l of links)
			if (l.source === "owner") l.at = nodes.get(l.target)?.at ?? l.at;

	for (const n of notes) {
		if (!byId.has(n.questionId)) continue;
		ensure({
			id: `n:${n.id}`,
			kind: "note",
			label: n.title,
			href: `/notes/${n.id}`,
			theme: n.theme,
			weight: 1,
			at: n.createdAt,
		});
		links.push({
			source: `q:${n.questionId}`,
			target: `n:${n.id}`,
			kind: "note",
			at: n.createdAt,
		});
	}

	// 橋の候補: 元のノート → 候補 → 持ち込み先のテーマの問い(いちばん歩いたもの)
	for (const b of bridges) {
		const from = b.fromNoteId ? nodes.get(`n:${b.fromNoteId}`) : undefined;
		const to = questions
			.filter((q) => q.theme === b.toTheme && q.track === "owner")
			.sort((a, c) => (c.visits ?? 0) - (a.visits ?? 0))[0];
		if (!from && !to) continue;
		ensure({
			id: `b:${b.id}`,
			kind: "idea",
			label: b.idea,
			href: "/context",
			theme: b.toTheme,
			weight: 1,
			at: b.createdAt,
		});
		if (from)
			links.push({
				source: from.id,
				target: `b:${b.id}`,
				kind: "idea",
				at: b.createdAt,
			});
		if (to)
			links.push({
				source: `b:${b.id}`,
				target: `q:${to.id}`,
				kind: "idea",
				at: b.createdAt,
			});
	}

	// 文字の近さの線。問いどうしだけ、閉じた・統合済みの問いも含めて(連想の跡として)
	const grams = questions.map((q) => ({ q, g: bigrams(q.text) }));
	for (let i = 0; i < grams.length; i++) {
		for (let j = i + 1; j < grams.length; j++) {
			const a = grams[i];
			const b = grams[j];
			if (!a || !b) continue;
			if (a.q.mergedInto === b.q.id || b.q.mergedInto === a.q.id) continue;
			const s = jaccard(a.g, b.g);
			if (s < NEAR) continue;
			links.push({
				source: `q:${a.q.id}`,
				target: `q:${b.q.id}`,
				kind: "near",
				strength: Math.round(s * 100) / 100,
				at: later(a.q.createdAt, b.q.createdAt),
			});
		}
	}

	const themes = [...new Set(questions.map((q) => q.theme))];
	return { nodes: [...nodes.values()], links, themes };
}
