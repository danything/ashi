import type { Config } from "../config.ts";
import { type Budget, newId, type Proposal, type Question } from "../state.ts";
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

/** 頭が出した新しい問いのうち、形が正しく、重複しないものを上限まで */
export function acceptNewQuestions(
	raw: RawQuestion[] | undefined,
	existing: Question[],
	cfg: Pick<Config, "maxNewQuestions">,
	parentId: string | undefined,
	now: Date,
): Question[] {
	const seen = new Set(existing.map((q) => normalizeText(q.text)));
	const out: Question[] = [];
	for (const r of raw ?? []) {
		if (out.length >= cfg.maxNewQuestions) break;
		if (typeof r?.text !== "string") continue;
		const text = r.text.trim().slice(0, 300);
		const key = normalizeText(text);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push({
			id: newId(),
			text,
			theme: normalizeTheme(r.theme),
			track: r.track === "owner" ? "owner" : "self",
			interest: unit(r.interest),
			importance: unit(r.importance),
			feasibility: unit(r.feasibility),
			status: "open",
			visits: 0,
			createdAt: now.toISOString(),
			parentId,
		});
	}
	return out;
}

/** 抱えている問いが多すぎたら、点の低いものから手放す */
export function trimOpenQuestions(
	qs: Question[],
	cfg: Pick<Config, "maxOpenQuestions">,
): Question[] {
	const open = qs
		.filter((q) => q.status === "open")
		.sort((a, b) => score(b) - score(a));
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
