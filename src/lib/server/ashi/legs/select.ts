import type { Config } from "../config.ts";
import type { Question, Track } from "../state.ts";

/**
 * 行き先(次に歩く問い)を選ぶ。頭の見立てを点数にするのも、寄り道のさいころを振るのも足。
 * 頭には選ばせない(選ばせると、いちばん面白そうな所をぐるぐる回り続ける)。
 */

/** 見立てと、何度歩いたかから出す点数 */
export function score(q: Question): number {
	const base = 0.4 * q.interest + 0.35 * q.importance + 0.25 * q.feasibility;
	// まだ歩いていない問いは少し前へ、何度も歩いた問いは後ろへ
	const novelty = q.visits === 0 ? 0.15 : 0;
	const fatigue = 0.12 * q.visits;
	return base + novelty - fatigue;
}

/** 直近で同じテーマが何歩続いたか */
export function themeStreak(recentThemes: string[]): {
	theme?: string;
	count: number;
} {
	const [theme] = recentThemes;
	if (theme === undefined) return { count: 0 };
	let count = 0;
	for (const t of recentThemes) {
		if (t !== theme) break;
		count++;
	}
	return { theme, count };
}

export interface Choice {
	question: Question;
	/** さいころで決めた系統 */
	track: Track;
	/**
	 * score: 点数の順 / detour: 寄り道 / echo: 言い換えが繰り返し出た問いを一度歩く /
	 * verify: 外で確かめずに言ったことを、日が経ったので確かめる
	 */
	reason: "score" | "detour" | "echo" | "verify" | "promised";
	score: number;
}

/** さいころで決めた系統に歩ける問いが無い。その系統の問いを頭に探させる */
export interface SeedNeeded {
	seed: Track;
	/** いま休ませているテーマ(探させる問いから外す) */
	avoid: string[];
}

/** この回数だけ言い換えが出て、まだ歩いていない問いは先に歩く */
export const ECHO_LIMIT = 3;

/** 外で確かめずに言ったことを確かめる問いは、この日数歩かれなければ先に歩く */
export const VERIFY_AFTER_DAYS = 2;

/** 問いを探しただけの歩みの印。テーマとしては数えない */
export const SEEDING = "(問いを探す)";

/**
 * いま休ませるテーマ。
 * - 連続: 直近で同じテーマが themeStreakLimit 歩続いた
 * - 窓: 直近 themeWindow 歩のうち themeWindowMax 回に達した(交互に挟まっても偏りを抑える)
 */
export function restingThemes(
	recentThemes: string[],
	cfg: Pick<Config, "themeStreakLimit" | "themeWindow" | "themeWindowMax">,
): string[] {
	const out = new Set<string>();
	const walked = recentThemes.filter((t) => t !== SEEDING);
	const streak = themeStreak(walked);
	if (streak.theme !== undefined && streak.count >= cfg.themeStreakLimit)
		out.add(streak.theme);
	const counts = new Map<string, number>();
	for (const t of walked.slice(0, cfg.themeWindow))
		counts.set(t, (counts.get(t) ?? 0) + 1);
	for (const [t, n] of counts) if (n >= cfg.themeWindowMax) out.add(t);
	return [...out];
}

export function selectQuestion(
	questions: Question[],
	recentThemes: string[],
	cfg: Pick<
		Config,
		| "themeStreakLimit"
		| "themeWindow"
		| "themeWindowMax"
		| "detourRate"
		| "ownerShare"
	>,
	rng: () => number = Math.random,
	now: Date = new Date(),
): Choice | SeedNeeded {
	const avoid = restingThemes(recentThemes, cfg);
	// 先に系統を決める。**その系統が空でも、もう一方には回さない。** 回すと、問いのある系統ばかり
	// 歩いて割合(ownerShare)が効かず、空の系統はいつまでも育たない(2026-09-25、最初の歩みで先回りの
	// 問いだけができ、個性がずっと 0 のままになりかけた)
	const track: Track = rng() < cfg.ownerShare ? "owner" : "self";
	const candidates = questions
		.filter(
			(q) =>
				q.status === "open" && !avoid.includes(q.theme) && q.track === track,
		)
		.map((q) => ({ question: q, score: score(q) }))
		.sort((a, b) => b.score - a.score);
	const [top, ...rest] = candidates;
	if (!top) return { seed: track, avoid };
	// 外(X・よそ者・持ち主)で確かめずに言ったことは、VERIFY_AFTER_DAYS 日歩かれなければ先に確かめる。
	// 点数のままだと、次の一歩に 2 回書いても選ばれず、言いっぱなしのまま日が経っていった
	// (Ashi の改善案、2026-09-26)。休ませているテーマでも回す(確かめるのは別の仕事なので)
	const overdue = questions
		.filter(
			(q) =>
				q.status === "open" &&
				q.track === track &&
				(q.verify || q.origin) &&
				q.visits === 0 &&
				now.getTime() - Date.parse(q.createdAt) >= VERIFY_AFTER_DAYS * 86400e3,
		)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
	if (overdue)
		return {
			question: overdue,
			score: score(overdue),
			track,
			reason: "verify",
		};
	// 内省の次の一歩に 2 回続けて書かれた問いは、1 回必ず歩く(休ませているテーマでも。歩いたら印は消える)。
	// 点数のままだと 3 回続けて書いても選ばれなかった(Ashi の改善案、2026-09-26)
	const promised = questions
		.filter(
			(q) => q.status === "open" && q.track === track && (q.promised ?? 0) >= 2,
		)
		.sort((a, b) => (b.promised ?? 0) - (a.promised ?? 0))[0];
	if (promised)
		return {
			question: promised,
			score: score(promised),
			track,
			reason: "promised",
		};
	// 言い換えが ECHO_LIMIT 回以上出たのに、まだ 1 度も歩いていない問いは、1 回だけ先に歩く。
	// 点数には足さない。繰り返しは関心の強さより堂々巡りの印のことが多く、点数に足すと堂々巡りを
	// 後押しする。歩けば答えが出るか棚に移るので、繰り返しがそこで止まる(Ashi の案、2026-09-25)
	const echo = candidates.find(
		(c) => (c.question.echoes ?? 0) >= ECHO_LIMIT && c.question.visits === 0,
	);
	if (echo) return { ...echo, track, reason: "echo" };
	if (rest.length > 0 && rng() < cfg.detourRate) {
		const pick = rest[Math.floor(rng() * rest.length)] ?? top;
		return { ...pick, track, reason: "detour" };
	}
	return { ...top, track, reason: "score" };
}
