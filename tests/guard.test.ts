import { describe, expect, test } from "bun:test";
import {
	applySettingsForm,
	normalizeConfig,
} from "../src/lib/server/ashi/config.ts";
import { taskUsage } from "../src/lib/server/ashi/head/head.ts";
import {
	acceptNewQuestions,
	acceptSelf,
	allowance,
	clampSleep,
	markPromised,
	normalizeTheme,
	readDepthSection,
	reopenable,
	trimOpenQuestions,
} from "../src/lib/server/ashi/legs/guard.ts";
import type { Question } from "../src/lib/server/ashi/state.ts";
import { freshStore, q } from "./helpers.ts";

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
		expect(normalizeConfig(undefined).model).toBe("claude-opus-5-5");
	});
});

describe("前の版の設定の取り込み", () => {
	test("ASHI_CONFIG・ASHI_FEEDS・settings.json を一度だけ ashi.json に取り込み、以後は環境変数を読まない", () => {
		const store = freshStore();
		store.writeText(
			"ashi.json",
			JSON.stringify({
				model: "claude-opus-5",
				budget: { dailyUsd: 2, stepUsd: 0.5 },
				reflectEvery: 7,
			}),
		);
		store.writeText("settings.json", JSON.stringify({ maxStepsPerDay: 12 }));
		const env = {
			ASHI_CONFIG:
				'{"model":"claude-opus-5-5","budget":{"dailyUsd":5},"x":{"enabled":false}}',
			ASHI_FEEDS: '[{"id":"gh","kind":"github","target":"5ym"}]',
		};
		expect(store.importLegacyConfig(env)).toEqual({
			result: "imported",
			from: ["ASHI_CONFIG", "ASHI_FEEDS", "settings.json"],
		});
		const c = store.config();
		expect(c).toMatchObject({
			model: "claude-opus-5-5",
			budget: { dailyUsd: 5, stepUsd: 0.5 },
			reflectEvery: 7,
			maxStepsPerDay: 12,
			x: { enabled: false },
		});
		expect(c.feeds.map((f) => f.id)).toEqual(["gh"]);
		// 2 回目は取り込まない(画面で変えた値を環境変数で上書きしない)
		store.saveConfig({ ...c, maxStepsPerDay: 20 });
		expect(store.importLegacyConfig(env)?.result).toBe("ignored");
		expect(store.config().maxStepsPerDay).toBe(20);
		expect(store.importLegacyConfig({})).toBeUndefined();
	});

	test("取り込むものが無ければ何もしない", () => {
		const store = freshStore();
		expect(store.importLegacyConfig({})).toBeUndefined();
		expect(store.importLegacyConfig({})).toBeUndefined();
	});
});

describe("acceptProposals", () => {
	const now = new Date("2026-09-25T12:00:00Z");
	test("3 件まで、同じ題は数を足し、見送った案がまた出たら開き直す", async () => {
		const { acceptProposals } = await import(
			"../src/lib/server/ashi/legs/guard.ts"
		);
		const first = acceptProposals(
			[
				{
					title: "同じテーマを回りすぎる",
					why: "k8s が続いた",
					idea: "連続の上限を下げる",
				},
				{ title: "", why: "x", idea: "y" },
				{ title: 1 },
			],
			[],
			now,
		);
		expect(first.added).toEqual(["同じテーマを回りすぎる"]);
		const again = acceptProposals(
			[{ title: "同じ テーマを回りすぎる", why: "また", idea: "" }],
			first.proposals,
			now,
		);
		expect(again.added).toEqual([]);
		expect(again.proposals[0]).toMatchObject({
			count: 2,
			why: "また",
			idea: "連続の上限を下げる",
		});

		const dismissed = again.proposals.map((p) => ({
			...p,
			status: "dismissed" as const,
		}));
		const reopened = acceptProposals(
			[{ title: "同じテーマを回りすぎる", why: "", idea: "" }],
			dismissed,
			now,
		);
		expect(reopened.proposals[0]?.status).toBe("open");

		const many = acceptProposals(
			Array.from({ length: 5 }, (_, i) => ({
				title: `案${i}`,
				why: "",
				idea: "",
			})),
			[],
			now,
		);
		expect(many.added).toHaveLength(3);
	});
});

test("使用量はキャッシュと仕事ごとに積み、日が変わったら前の日を budget-history に残す", () => {
	const store = freshStore();
	const u = (task: string, input: number, read: number) =>
		taskUsage(task, {
			inputTokens: input,
			outputTokens: 1,
			costUsd: 0,
			cacheReadTokens: read,
			cacheWriteTokens: 0,
		});
	store.charge("2026-10-02", u("explore", 100, 90), true);
	store.charge("2026-10-02", u("explore", 50, 40));
	store.charge("2026-10-02", u("reflect", 10, 0));
	expect(store.budget("2026-10-02")).toMatchObject({
		inputTokens: 160,
		cacheReadTokens: 130,
		steps: 1,
		byTask: {
			explore: {
				calls: 2,
				inputTokens: 150,
				outputTokens: 2,
				cacheReadTokens: 130,
			},
			reflect: {
				calls: 1,
				inputTokens: 10,
				outputTokens: 1,
				cacheReadTokens: 0,
			},
		},
	});
	store.charge("2026-10-03", u("explore", 5, 0));
	expect(store.budgetHistory()).toHaveLength(1);
	expect(store.budgetHistory()[0]).toMatchObject({
		day: "2026-10-02",
		inputTokens: 160,
	});
	expect(store.budget("2026-10-03").inputTokens).toBe(5);
});

test("設定の画面のフォームを当てる。載っていない項目はそのまま、範囲の外は丸める", () => {
	const cfg = normalizeConfig({
		maxStepsPerDay: 30,
		x: { enabled: true, dailyUsd: 2 },
		feeds: [{ id: "blog", kind: "rss", target: "https://a.example/rss" }],
		reflectEvery: 7,
	});
	const f = new FormData();
	f.set("maxStepsPerDay", "12");
	f.set("maxToolRounds", "999");
	f.set("effort", "medium");
	f.set("stranger.enabled:shown", "1");
	f.set("stranger.enabled", "on");
	f.set("x.enabled:shown", "1");
	f.set("feeds:shown", "1");
	for (const [id, kind, target] of [
		["blog", "rss", "https://a.example/rss"],
		["gh", "github", "5ym"],
		["", "rss", ""],
	]) {
		f.append("feed.id", id ?? "");
		f.append("feed.kind", kind ?? "");
		f.append("feed.target", target ?? "");
		f.append("feed.title", "");
	}
	f.append("feed.remove", "0");
	const next = applySettingsForm(cfg, f);
	expect(next).toMatchObject({
		maxStepsPerDay: 12,
		maxToolRounds: 50,
		effort: "medium",
		reflectEvery: 7,
	});
	expect(next.stranger.enabled).toBe(true);
	// チェックの無い X は止まり、ほかの X の値は残る
	expect(next.x).toMatchObject({ enabled: false, dailyUsd: 2 });
	expect(next.feeds.map((x) => x.id)).toEqual(["gh"]);
	// 印の無いチェックボックスは触らない
	expect(applySettingsForm(next, new FormData()).stranger.enabled).toBe(true);
});

test("次の一歩に書かれた問いが上限で手放されていたら開き直す。統合で手放した問いは開かない", () => {
	const qs = [
		q({ id: "aaaaaaa1", status: "dropped" }),
		q({ id: "aaaaaaa2", status: "dropped", mergedInto: "aaaaaaa3" }),
		q({ id: "aaaaaaa3" }),
	];
	const next = markPromised(qs, ["aaaaaaa1 の続き", "aaaaaaa2 も"]);
	expect(next[0]).toMatchObject({ status: "open", promised: 1 });
	expect(next[1]?.status).toBe("dropped");
	expect(reopenable(qs[0] as Question)).toBe(true);
});

test("出典ごとに読めた深さをノートに残し、要旨だけの出典で「無い」と言い切っていたら注意書きを付ける", () => {
	const r = readDepthSection(
		[
			{ source: "Kalske ら 2019", depth: "abstract" },
			{ source: "Smith 2020", depth: "methods" },
			{ source: "", depth: "full" },
			{ source: "x", depth: "skimmed" },
		],
		"組の作り方は論文に書かれていない。",
	);
	expect(r.shallow).toBe(1);
	expect(r.text).toContain("- 要旨だけ: Kalske ら 2019");
	expect(r.text).toContain("- 方法の節まで: Smith 2020");
	expect(r.text).toContain("足の注意");
	expect(
		readDepthSection([{ source: "a", depth: "full" }], "書かれていない").text,
	).not.toContain("足の注意");
	expect(readDepthSection(undefined, "").text).toBe("");
});
