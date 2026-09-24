import { describe, expect, test } from "bun:test";
import { normalizeConfig } from "../src/lib/server/ashi/config.ts";
import {
	acceptNewQuestions,
	acceptSelf,
	allowance,
	clampSleep,
	normalizeTheme,
	trimOpenQuestions,
} from "../src/lib/server/ashi/legs/guard.ts";
import { q } from "./helpers.ts";

const now = new Date("2026-09-24T12:00:00Z");

describe("clampSleep", () => {
	const cfg = { sleep: { minMinutes: 10, maxMinutes: 60 } };
	test("範囲に丸める", () => {
		expect(clampSleep(1, cfg)).toBe(10);
		expect(clampSleep(999, cfg)).toBe(60);
		expect(clampSleep(30.4, cfg)).toBe(30);
	});
	test("数でなければ下限", () => {
		expect(clampSleep("ずっと", cfg)).toBe(10);
		expect(clampSleep(Number.NaN, cfg)).toBe(10);
	});
});

describe("normalizeTheme", () => {
	test("表記ゆれを畳む", () => {
		expect(normalizeTheme(" Ｒｕｓｔ  言語 ")).toBe("rust 言語");
		expect(normalizeTheme("")).toBe("その他");
		expect(normalizeTheme(42)).toBe("その他");
	});
});

describe("acceptNewQuestions", () => {
	test("重複と空を落とし、上限で切り、見立てを 0〜1 に丸める", () => {
		const got = acceptNewQuestions(
			[
				{ text: "既にある問い" },
				{ text: "" },
				{ text: "新しい問い", interest: 5, importance: -1, track: "owner" },
				{ text: "新しい 問い" },
				{ text: "二つ目" },
				{ text: "三つ目" },
			],
			[q({ text: "既にある問い" })],
			{ maxNewQuestions: 2 },
			"p1",
			now,
		);
		expect(got.map((x) => x.text)).toEqual(["新しい問い", "二つ目"]);
		expect(got[0]).toMatchObject({
			interest: 1,
			importance: 0,
			feasibility: 0.5,
			track: "owner",
			parentId: "p1",
		});
		expect(got[1]?.track).toBe("self");
	});

	test("形の違うものは受け取らない", () => {
		expect(
			acceptNewQuestions(
				[null as never, { text: 1 }],
				[],
				{ maxNewQuestions: 5 },
				undefined,
				now,
			),
		).toEqual([]);
		expect(
			acceptNewQuestions(undefined, [], { maxNewQuestions: 5 }, undefined, now),
		).toEqual([]);
	});
});

describe("trimOpenQuestions", () => {
	test("点の低いものから手放す", () => {
		const hi = q({ interest: 1 });
		const lo = q({ interest: 0 });
		const done = q({ status: "answered" });
		const got = trimOpenQuestions([lo, hi, done], { maxOpenQuestions: 1 });
		expect(got.find((x) => x.id === lo.id)?.status).toBe("dropped");
		expect(got.find((x) => x.id === hi.id)?.status).toBe("open");
		expect(got.find((x) => x.id === done.id)?.status).toBe("answered");
	});
});

describe("acceptSelf", () => {
	test("短すぎ・長すぎ・文字でないものは受け取らない", () => {
		expect(acceptSelf("短い")).toBeUndefined();
		expect(acceptSelf("あ".repeat(5000))).toBeUndefined();
		expect(acceptSelf({})).toBeUndefined();
		expect(
			acceptSelf("  私は星の名前の由来を追いかけるのが好きな歩き手だ。  "),
		).toBe("私は星の名前の由来を追いかけるのが好きな歩き手だ。\n");
	});
});

describe("allowance", () => {
	const cfg = { budget: { dailyUsd: 1, stepUsd: 0.3 } };
	test("1 歩の上限と 1 日の残りの小さいほう", () => {
		expect(
			allowance(
				{ day: "d", spentUsd: 0, inputTokens: 0, outputTokens: 0 },
				cfg,
			),
		).toBe(0.3);
		expect(
			allowance(
				{ day: "d", spentUsd: 0.9, inputTokens: 0, outputTokens: 0 },
				cfg,
			),
		).toBeCloseTo(0.1);
		expect(
			allowance(
				{ day: "d", spentUsd: 2, inputTokens: 0, outputTokens: 0 },
				cfg,
			),
		).toBe(0);
	});
});

describe("normalizeConfig", () => {
	test("無茶な値は範囲に丸める", () => {
		const c = normalizeConfig({
			budget: { dailyUsd: -5, stepUsd: 100 },
			sleep: { minMinutes: 0, maxMinutes: 1 },
			detourRate: 3,
			ownerShare: -1,
			effort: "ultra",
		});
		expect(c.budget).toEqual({ dailyUsd: 0, stepUsd: 0 });
		expect(c.sleep).toEqual({ minMinutes: 1, maxMinutes: 1 });
		expect(c.detourRate).toBe(1);
		expect(c.ownerShare).toBe(0);
		expect(c.effort).toBe("high");
	});
	test("空なら既定", () => {
		expect(normalizeConfig(undefined).model).toBe("claude-opus-5");
	});
});

describe("ASHI_FEEDS", () => {
	test("環境変数の足跡が ashi.json より勝つ", async () => {
		const { freshStore } = await import("./helpers.ts");
		const store = freshStore();
		store.writeText(
			"ashi.json",
			JSON.stringify({
				feeds: [{ kind: "rss", target: "https://a.example/rss" }],
			}),
		);
		process.env.ASHI_FEEDS = '[{"id":"gh","kind":"github","target":"5ym"}]';
		try {
			expect(store.config().feeds).toEqual([
				{ id: "gh", kind: "github", target: "5ym", title: undefined },
			]);
			process.env.ASHI_FEEDS = "{壊れた";
			expect(store.config().feeds[0]?.target).toBe("https://a.example/rss");
		} finally {
			delete process.env.ASHI_FEEDS;
		}
	});
});

describe("ASHI_CONFIG", () => {
	test("ashi.json の上に重ね、入れ子は一部だけ書けばよい", async () => {
		const { freshStore } = await import("./helpers.ts");
		const store = freshStore();
		store.writeText(
			"ashi.json",
			JSON.stringify({
				budget: { dailyUsd: 2, stepUsd: 0.5 },
				reflectEvery: 7,
			}),
		);
		process.env.ASHI_CONFIG = '{"budget":{"dailyUsd":5}}';
		try {
			const c = store.config();
			expect(c.budget).toEqual({ dailyUsd: 5, stepUsd: 0.5 });
			expect(c.reflectEvery).toBe(7);
			// 範囲の外は丸める
			process.env.ASHI_CONFIG = '{"budget":{"dailyUsd":99999}}';
			expect(store.config().budget.dailyUsd).toBe(1000);
		} finally {
			delete process.env.ASHI_CONFIG;
		}
	});
});
