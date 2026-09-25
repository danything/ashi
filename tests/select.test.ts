import { describe, expect, test } from "bun:test";
import {
	restingThemes,
	score,
	selectQuestion,
	themeStreak,
} from "../src/lib/server/ashi/legs/select.ts";
import { q } from "./helpers.ts";

/** 歩いた(問いを選んだ)ほうの答えだけを取り出す */
const walked = (c: ReturnType<typeof selectQuestion>) => {
	if (!("question" in c)) throw new Error(`問いを探させた: ${c.seed}`);
	return c;
};

const cfg = {
	themeStreakLimit: 3,
	themeWindow: 10,
	themeWindowMax: 3,
	detourRate: 0,
	ownerShare: 0.5,
};
/** 決まった順に値を返すさいころ */
const dice = (...xs: number[]) => {
	let i = 0;
	return () => xs[i++ % xs.length] ?? 0;
};

describe("score", () => {
	test("歩くほど下がる", () => {
		expect(score(q({ visits: 0 }))).toBeGreaterThan(score(q({ visits: 1 })));
		expect(score(q({ visits: 1 }))).toBeGreaterThan(score(q({ visits: 3 })));
	});
});

describe("themeStreak", () => {
	test("先頭から同じテーマが続く数", () => {
		expect(themeStreak(["a", "a", "b", "a"])).toEqual({ theme: "a", count: 2 });
		expect(themeStreak([])).toEqual({ count: 0 });
	});
});

describe("selectQuestion", () => {
	test("系統の中で点の高いものを選ぶ", () => {
		const hi = q({ interest: 1, importance: 1 });
		const lo = q({ interest: 0 });
		const c = selectQuestion([lo, hi], [], cfg, dice(0.9));
		expect(walked(c).question.id).toBe(hi.id);
		expect(walked(c).reason).toBe("score");
		expect(walked(c).track).toBe("self");
	});

	test("さいころで先回りの系統を選ぶ", () => {
		const own = q({ track: "owner", interest: 0 });
		const self = q({ track: "self", interest: 1 });
		expect(
			walked(selectQuestion([own, self], [], cfg, dice(0.1))).question.id,
		).toBe(own.id);
		expect(
			walked(selectQuestion([own, self], [], cfg, dice(0.9))).question.id,
		).toBe(self.id);
	});

	test("出た系統が空なら、もう一方には回さず、その系統の問いを探させる", () => {
		const self = q({ track: "self" });
		expect(selectQuestion([self], [], cfg, dice(0.1))).toEqual({
			seed: "owner",
			avoid: [],
		});
		expect(selectQuestion([q({ track: "owner" })], [], cfg, dice(0.9))).toEqual(
			{ seed: "self", avoid: [] },
		);
	});

	test("同じテーマが上限まで続いたら、そのテーマは選ばない", () => {
		const same = q({ theme: "a", interest: 1, importance: 1 });
		const other = q({ theme: "b", interest: 0 });
		const c = selectQuestion([same, other], ["a", "a", "a"], cfg, dice(0.9));
		expect("question" in c && c.question.id).toBe(other.id);
	});

	test("選べるものが無ければ、出た系統の問いを探させる", () => {
		expect(
			selectQuestion([q({ theme: "a" })], ["a", "a", "a"], cfg, dice(0.9)),
		).toEqual({
			seed: "self",
			avoid: ["a"],
		});
		expect(
			selectQuestion([q({ status: "answered" })], [], cfg, dice(0.9)),
		).toEqual({ seed: "self", avoid: [] });
		expect(
			selectQuestion([q({ status: "parked" })], [], cfg, dice(0.9)),
		).toEqual({ seed: "self", avoid: [] });
	});

	test("寄り道は一番以外から選ぶ", () => {
		const top = q({ interest: 1, importance: 1, feasibility: 1 });
		const a = q({ interest: 0.2 });
		const c = selectQuestion(
			[top, a],
			[],
			{ ...cfg, detourRate: 1 },
			dice(0.9, 0, 0),
		);
		expect(walked(c).reason).toBe("detour");
		expect(walked(c).question.id).toBe(a.id);
	});
});

describe("restingThemes", () => {
	test("交互に挟まっても、直近の窓で多いテーマは休ませる", () => {
		// 実際の足どり(2026-09-25): 稼働表が 1 つおきに続き、連続の上限には一度も当たらなかった
		const recent = [
			"稼働表",
			"睡眠",
			"稼働表",
			"年輪",
			"稼働表",
			"睡眠",
			"(問いを探す)",
			"自律",
		];
		expect(restingThemes(recent, cfg)).toEqual(["稼働表"]);
		expect(restingThemes(["a", "b", "a"], cfg)).toEqual([]);
	});

	test("問いを探しただけの歩みは数えず、連続も切らない", () => {
		expect(restingThemes(["a", "(問いを探す)", "a", "a"], cfg)).toContain("a");
	});
});

describe("言い換えの繰り返し(echoes)", () => {
	test("echoes が 3 以上でまだ歩いていない問いは、点数が低くても 1 回だけ先に歩く", () => {
		const hi = q({ id: "hi", interest: 1, importance: 1 });
		const loop = q({ id: "loop", interest: 0, importance: 0, echoes: 3 });
		const c = walked(selectQuestion([hi, loop], [], cfg, dice(0.9)));
		expect(c.question.id).toBe("loop");
		expect(c.reason).toBe("echo");
		// 1 度歩いたら、あとは点数の順
		const walkedOnce = { ...loop, visits: 1 };
		expect(
			walked(selectQuestion([hi, walkedOnce], [], cfg, dice(0.9))).question.id,
		).toBe("hi");
		// 2 回までは点数どおり
		expect(
			walked(selectQuestion([hi, { ...loop, echoes: 2 }], [], cfg, dice(0.9)))
				.question.id,
		).toBe("hi");
	});
});
