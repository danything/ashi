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
	/** score: 点数の順 / detour: 寄り道 */
	reason: "score" | "detour";
	score: number;
}

/** さいころで決めた系統に歩ける問いが無い。その系統の問いを頭に探させる */
export interface SeedNeeded {
	seed: Track;
	/** いま休ませているテーマ(探させる問いから外す) */
	avoid: string[];
}

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
	if (rest.length > 0 && rng() < cfg.detourRate) {
		const pick = rest[Math.floor(rng() * rest.length)] ?? top;
		return { ...pick, track, reason: "detour" };
	}
	return { ...top, track, reason: "score" };
}
