import { describe, expect, test } from "bun:test";
import {
	acceptNewQuestions,
	applyMerges,
	bigrams,
	jaccard,
	ownerPull,
	similarPairs,
} from "../src/lib/server/ashi/legs/guard.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
import { openList } from "../src/lib/server/ashi/prompts.ts";
import { explore, FakeHead, freshStore, q } from "./helpers.ts";

const now = new Date("2026-09-25T12:00:00");
const cfg = { maxNewQuestions: 5, maxOpenPerTheme: 3 };

// 2026-09-25 に実際に抱えていた問いから
const EFFECT =
	"フランスやオーストラリアの「つながらない権利」は、施行後に働き方や連絡の習慣を実際に変えたのか?";
const EFFECT2 =
	"フランスやオーストラリアの「つながらない権利」は、施行後に時間外の連絡を実際に減らしたのか、調べたデータはあるか。";
const DEFINE =
	"フランスやオーストラリアの「つながらない権利」は、勤務時間外の連絡を法的にどう扱い、どう定義しているのか。";

describe("ほぼ同じ問い", () => {
	test("文字がほぼ同じ言い換えは受け取らず、既存の問いの echoes を足す", () => {
		const existing = [q({ text: EFFECT, theme: "労働時間" })];
		const got = acceptNewQuestions(
			[{ text: EFFECT2, theme: "労働時間" }],
			existing,
			cfg,
			undefined,
			now,
		);
		expect(got).toEqual([]);
		expect(existing[0]?.echoes).toBe(1);
	});

	test("話題が同じでも別のことを聞く問い(定義か効果か)は受け取る", () => {
		expect(jaccard(bigrams(DEFINE), bigrams(EFFECT2))).toBeLessThan(0.45);
		const got = acceptNewQuestions(
			[{ text: DEFINE, theme: "労働時間" }],
			[q({ text: EFFECT2 })],
			cfg,
			undefined,
			now,
		);
		expect(got).toHaveLength(1);
	});

	test("テーマの開いた問いが上限なら受け取らない。出どころを残す", () => {
		const existing = [
			q({ theme: "労働時間", text: "a1" }),
			q({ theme: "労働時間", text: "b2" }),
			q({ theme: "労働時間", text: "c3" }),
		];
		const got = acceptNewQuestions(
			[
				{ text: "労働時間のまったく別の問い", theme: "労働時間" },
				{ text: "星の名前の由来", theme: "天文" },
			],
			existing,
			cfg,
			undefined,
			now,
			{ source: "x", via: "5yuim" },
		);
		expect(got.map((x) => [x.text, x.source, x.via])).toEqual([
			["星の名前の由来", "x", "5yuim"],
		]);
	});

	test("similarPairs は同じ系統の近い組を近い順に返し、ほぼ同じ組より下のものも拾う", () => {
		const pairs = similarPairs([
			q({ text: EFFECT }),
			q({ text: DEFINE }),
			q({ text: "星の名前の由来" }),
			q({ text: EFFECT2, track: "owner" }),
		]);
		expect(pairs).toHaveLength(1);
		expect(pairs[0]?.[2]).toBeGreaterThan(0.25);
	});
});

describe("applyMerges", () => {
	test("keep に drop を寄せ、テーマを揃え、割れたテーマ名を付け替える。知らない ID は無視", () => {
		const a = q({ id: "a", theme: "労働時間" });
		const b = q({ id: "b", theme: "労働と時間", echoes: 2 });
		const c = q({ id: "c", theme: "働く時間の境界" });
		const d = q({ id: "d", theme: "労働時間の定義" });
		const r = applyMerges(
			[a, b, c, d],
			[{ keep: "a", drop: ["b", "nope", "a"], theme: "つながらない権利" }],
			[{ from: ["働く時間の境界", "労働時間の定義"], to: "労働時間" }],
		);
		const by = new Map(r.questions.map((x) => [x.id, x]));
		expect(by.get("b")).toMatchObject({ status: "dropped", mergedInto: "a" });
		expect(by.get("a")).toMatchObject({
			status: "open",
			theme: "つながらない権利",
			echoes: 3,
		});
		expect([by.get("c")?.theme, by.get("d")?.theme]).toEqual([
			"労働時間",
			"労働時間",
		]);
		expect([r.merged, r.renamed]).toEqual([1, 2]);
	});
});

describe("ownerPull", () => {
	test("親が先回り・地図・対話・X で持ち主と話して生まれた個性の問いを数える", () => {
		const owner = q({ id: "o", track: "owner" });
		const qs = [
			owner,
			q({ track: "self", parentId: "o" }),
			q({ track: "self", source: "x", via: "someone,5yuim" }),
			q({ track: "self", source: "x", via: "someone" }),
			q({ track: "self", source: "seed" }),
			q({ track: "self" }),
		];
		expect(ownerPull(qs, ["5yuim"])).toEqual({
			fromOwner: 2,
			known: 4,
			total: 5,
		});
	});
});

describe("内省の棚卸し", () => {
	test("全部の問いをテーマごとに見せ、統合の候補と持ち主からの割合を渡し、頭の統合を当てる", async () => {
		const store = freshStore();
		store.saveQuestions([
			q({ id: "e1", track: "self", theme: "労働時間", text: EFFECT }),
			q({ id: "e2", track: "self", theme: "労働と時間", text: DEFINE }),
			...Array.from({ length: 35 }, (_, i) =>
				q({
					id: `z${i}`,
					track: "self",
					theme: "その他",
					text: `問い ${i} 番`,
				}),
			),
		]);
		store.saveWalk({ ...store.walk(), steps: 4 });
		const head = new FakeHead({
			explore: () => explore(),
			reflect: (req) => {
				// 30 本で切らずに全部見せる
				expect(req.prompt).toContain("問い 34 番");
				expect(req.prompt).toContain("### その他(");
				expect(req.prompt).toContain("文字の近い問いの組");
				expect(req.prompt).toContain("持ち主から生まれたもの");
				return {
					diary: "d",
					self: "私は寄り道が好きな歩き手で、問いの連鎖を追うのが楽しい。",
					next_steps: [],
					bridge_ideas: [],
					proposals: [],
					posts: [],
					merges: [{ keep: "e1", drop: ["e2"], theme: "つながらない権利" }],
					themes: [],
				};
			},
		});
		await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
		const e2 = store.questions().find((x) => x.id === "e2");
		expect(e2).toMatchObject({ status: "dropped", mergedInto: "e1" });
		expect(
			store.recentLog(3).find((e) => e.event === "reflected"),
		).toMatchObject({ merged: 1 });
	});
});

describe("テーマの上限を問いの一覧で知らせる", () => {
	test("上限に達したテーマと、あと 1 本のテーマに印を付ける", () => {
		const qs = [
			q({ id: "a1", theme: "労働時間" }),
			q({ id: "a2", theme: "労働時間" }),
			q({ id: "a3", theme: "労働時間" }),
			q({ id: "b1", theme: "言葉の来歴" }),
			q({ id: "b2", theme: "言葉の来歴" }),
			q({ id: "c1", theme: "見えない仕事" }),
		];
		const text = openList(qs, 3);
		expect(text).toContain(
			"### 労働時間(3・上限 3 に達している。新しい問いは受け取られない)",
		);
		expect(text).toContain("### 言葉の来歴(2・上限 3 まであと 1 本)");
		expect(text).toContain("### 見えない仕事(1)");
		expect(openList(qs)).toContain("### 労働時間(3)");
	});
});
