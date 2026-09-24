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
	/** さいころで決めた系統(その系統に歩ける問いが無ければ、もう一方) */
	track: Track;
	/** score: 点数の順 / detour: 寄り道 */
	reason: "score" | "detour";
	score: number;
}

export function selectQuestion(
	questions: Question[],
	recentThemes: string[],
	cfg: Pick<Config, "themeStreakLimit" | "detourRate" | "ownerShare">,
	rng: () => number = Math.random,
): Choice | null {
	const streak = themeStreak(recentThemes);
	// 同じテーマが上限まで続いたら、そのテーマは今回は選べない
	const banned =
		streak.count >= cfg.themeStreakLimit ? streak.theme : undefined;
	const walkable = questions.filter(
		(q) => q.status === "open" && q.theme !== banned,
	);
	// 先に系統を決める。その系統が空なら、もう一方を歩く
	const want: Track = rng() < cfg.ownerShare ? "owner" : "self";
	const other: Track = want === "owner" ? "self" : "owner";
	for (const track of [want, other]) {
		const candidates = walkable
			.filter((q) => q.track === track)
			.map((q) => ({ question: q, score: score(q) }))
			.sort((a, b) => b.score - a.score);
		const [top, ...rest] = candidates;
		if (!top) continue;
		if (rest.length > 0 && rng() < cfg.detourRate) {
			const pick = rest[Math.floor(rng() * rest.length)] ?? top;
			return { ...pick, track, reason: "detour" };
		}
		return { ...top, track, reason: "score" };
	}
	return null;
}
