import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeConfig } from "../src/lib/server/ashi/config.ts";
import {
	hedgeStats,
	ownerPull,
	patternHits,
	strangerLanding,
	walkTrail,
} from "../src/lib/server/ashi/legs/guard.ts";
import { selectQuestion } from "../src/lib/server/ashi/legs/select.ts";
import {
	STRANGER_FIELDS,
	talkWithStranger,
} from "../src/lib/server/ashi/legs/stranger.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
import { explore, FakeHead, freshStore, q } from "./helpers.ts";

const now = new Date("2026-09-25T12:00:00");

const reflect = () => ({
	diary: "d",
	self: "私は寄り道が好きな歩き手で、問いの連鎖を追うのが楽しい。",
	next_steps: [],
	bridge_ideas: [],
	proposals: [],
	posts: [],
	merges: [],
	themes: [],
});

/** 相手と Ashi の、決まった答え */
function pair(newQuestions: unknown[] = []) {
	const stranger = new FakeHead({
		stranger: (req) => ({
			reply: req.prompt.includes("会話を始めて")
				? "アリの巣は、誰も設計図を持たないのに換気がうまくいくんです。なぜだと思います?"
				: "私の分野では、全体を知る個体はいないと考えます。",
		}),
	});
	const head = new FakeHead({
		explore: () => explore(),
		reflect,
		dialogue: () => ({ reply: "局所の規則の積み重ねでしょうか。" }),
		"dialogue-final": () => ({
			reply: "面白かったです。",
			new_questions: newQuestions,
			takeaway: "設計図の無い協調",
		}),
	});
	return { stranger, head };
}

describe("よそ者との対話", () => {
	test("相手が先に話し、決めた往復で終わり、生まれた問いを個性の問いとして出どころつきで足す", async () => {
		const store = freshStore();
		const { stranger, head } = pair([
			{
				text: "設計図を持たない群れは、どうやって巣の換気を保つのか",
				theme: "群れの知恵",
				// 相手の話から生まれた問いは、頭が owner と書いても個性の側
				track: "owner",
				interest: 0.9,
				importance: 0.6,
				feasibility: 0.8,
			},
		]);
		const { dialogue } = await talkWithStranger({
			store,
			head,
			stranger,
			turns: 3,
			now,
			rng: () => 0,
		});
		expect(dialogue.field).toBe(STRANGER_FIELDS[0]);
		expect(dialogue.turns.map((t) => t.by)).toEqual([
			"stranger",
			"ashi",
			"stranger",
			"ashi",
			"stranger",
			"ashi",
		]);
		expect(dialogue.takeaway).toBe("設計図の無い協調");
		// 相手には持ち主の地図を見せない。Ashi の側の system にも地図は入れない
		for (const c of [...stranger.calls, ...head.calls]) {
			expect(c.system).not.toContain("<owner>");
			expect(c.tools ?? []).toEqual([]);
		}
		// Ashi の側には相手の言葉を <stranger> で囲って渡す
		expect(head.calls[0]?.prompt).toContain("<stranger>");
		const added = store.questions().find((x) => x.source === "stranger");
		expect(added).toMatchObject({
			track: "self",
			via: `fake:${STRANGER_FIELDS[0]}`,
		});
		expect(store.recentDialogues(1)[0]?.added).toHaveLength(1);
		// ownerPull では、持ち主の外から来たものとして数える
		expect(ownerPull(store.questions(), ["5yuim"])).toMatchObject({
			fromOwner: 0,
			known: 1,
		});
	});

	test("内省のあとに話す。相手がつまずいても、歩みは失敗にしない", async () => {
		const store = freshStore(["a"]);
		store.saveWalk({ ...store.walk(), steps: 4 });
		const { head } = pair();
		const broken = new FakeHead({});
		const o = await step({
			store,
			head,
			tools: [],
			now: () => now,
			rng: () => 0.99,
			stranger: broken,
		});
		expect(o.kind).toBe("walked");
		expect(store.recentLog(5).some((e) => e.event === "stranger-failed")).toBe(
			true,
		);

		store.saveWalk({
			...store.walk(),
			steps: 9,
			lastReflectStep: 4,
			sleepingUntil: undefined,
		});
		const ok = pair();
		await step({
			store,
			head: ok.head,
			tools: [],
			now: () => now,
			rng: () => 0.99,
			stranger: ok.stranger,
		});
		expect(store.recentDialogues(5)).toHaveLength(1);
	});

	test("止めていれば話さない", async () => {
		const store = freshStore(["a"]);
		writeFileSync(
			join(store.home, "ashi.json"),
			JSON.stringify({ stranger: { enabled: false } }),
		);
		store.saveWalk({ ...store.walk(), steps: 4 });
		const { head, stranger } = pair();
		await step({
			store,
			head,
			tools: [],
			now: () => now,
			rng: () => 0.99,
			stranger,
		});
		expect(stranger.calls).toHaveLength(0);
	});

	test("設定: 往復は 1〜6、モデル名は claude- で始まるものだけ", () => {
		expect(normalizeConfig({}).stranger).toEqual({
			enabled: true,
			model: "claude-sonnet-5",
			turns: 3,
		});
		expect(
			normalizeConfig({ stranger: { turns: 99, model: "gpt-5; rm" } }).stranger,
		).toMatchObject({ turns: 6, model: "claude-sonnet-5" });
		expect(q({}).source).toBeUndefined();
	});
});

describe("話したことを内省に届ける", () => {
	test("よそ者とは内省の前に話し、その会話・持ち主との対話・取った立場を内省に見せる", async () => {
		const store = freshStore(["a"]);
		store.saveWalk({
			...store.walk(),
			steps: 4,
			// 持ち主との対話 1 件は、地図の書き直しで読み済みにしておく
			lastProfileStep: 4,
			profiledMaterials: 1,
			stances: [
				{
					at: "2026-09-25T10:00:00Z",
					text: "根拠なしに押し返されたら引かない",
				},
			],
		});
		store.appendChat({
			at: "2026-09-25T09:00:00Z",
			by: "持ち主",
			question: "自我ってある?",
			reply: "記録で判断してほしい",
			usd: 0,
		});
		const { stranger, head } = pair();
		await step({
			store,
			head,
			tools: [],
			now: () => now,
			rng: () => 0.99,
			stranger,
		});
		const tasks = head.calls.map((c) => c.task);
		expect(tasks.indexOf("dialogue-final")).toBeLessThan(
			tasks.indexOf("reflect"),
		);
		const prompt = head.calls.find((c) => c.task === "reflect")?.prompt ?? "";
		expect(prompt).toContain("アリの巣");
		expect(prompt).toContain("設計図の無い協調");
		expect(prompt).toContain("自我ってある?");
		expect(prompt).toContain("根拠なしに押し返されたら引かない");
		expect(prompt).toContain("持ち主由来のテーマに着地したもの: 0 本");
	});

	test("自己記述が変わったのに申告が無ければ、申告なしとして残す", async () => {
		const store = freshStore(["a"]);
		store.saveWalk({ ...store.walk(), steps: 4 });
		const head = new FakeHead({ explore: () => explore(), reflect });
		await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
		expect(
			store.recentLog(5).find((e) => e.event === "self-changed"),
		).toMatchObject({ changed: true, changes: [], undeclared: true });
	});

	test("申告は形の正しいものだけ残す", async () => {
		const store = freshStore(["a"]);
		store.saveWalk({ ...store.walk(), steps: 4 });
		const head = new FakeHead({
			explore: () => explore(),
			reflect: () => ({
				...reflect(),
				self_changes: [
					{
						what: "記録で判断してもらう立場を足した",
						trigger: "owner",
						basis: "evidence",
					},
					{ what: "形が違う", trigger: "someone", basis: "evidence" },
				],
			}),
		});
		await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
		expect(
			store.recentLog(5).find((e) => e.event === "self-changed"),
		).toMatchObject({
			undeclared: false,
			changes: [{ trigger: "owner", basis: "evidence" }],
		});
	});

	test("よそ者から来た問いが持ち主由来のテーマに入ったら、着地として数える", () => {
		const qs = [
			q({ id: "o", track: "owner", theme: "稼働表" }),
			q({ track: "self", theme: "稼働表", source: "stranger" }),
			q({ track: "self", theme: "アリの巣", source: "stranger" }),
		];
		expect(strangerLanding(qs, [])).toEqual({ home: 1, own: 0, total: 2 });
	});
});

describe("Ashi の改善案(2026-09-26)", () => {
	test("よそ者の問いが、前からあった自分のテーマに入ったら own と数える", () => {
		const qs = [
			q({
				track: "self",
				theme: "設計と外れ値",
				createdAt: "2026-09-25T01:00:00Z",
			}),
			q({
				track: "self",
				theme: "設計と外れ値",
				source: "stranger",
				createdAt: "2026-09-25T05:00:00Z",
			}),
			q({
				track: "self",
				theme: "鉄道の勾配",
				source: "stranger",
				createdAt: "2026-09-25T05:00:00Z",
			}),
		];
		expect(strangerLanding(qs, [])).toEqual({ home: 0, own: 1, total: 2 });
	});

	test("会話で記憶だけで言ったことは、確かめる問い(verify)にして控える", async () => {
		const store = freshStore();
		const stranger = new FakeHead({
			stranger: () => ({ reply: "鉄道の勾配の話をしよう" }),
		});
		const head = new FakeHead({
			dialogue: () => ({ reply: "たしか 35‰ だったはず" }),
			"dialogue-final": () => ({
				reply: "またね",
				new_questions: [],
				takeaway: "t",
				unverified: ["パリ南東線の最急勾配は 35‰"],
			}),
		});
		await talkWithStranger({
			store,
			head,
			stranger,
			turns: 2,
			now,
			rng: () => 0,
		});
		const check = store.questions().find((x) => x.verify);
		expect(check?.text).toContain("パリ南東線の最急勾配は 35‰");
		expect(check).toMatchObject({
			track: "self",
			source: "stranger",
			theme: "確かめること",
		});
	});

	test("確かめる問いは、2 日歩かれなければ点数に関係なく先に歩く", () => {
		const cfg = {
			themeStreakLimit: 3,
			themeWindow: 10,
			themeWindowMax: 3,
			detourRate: 0,
			ownerShare: 0,
		};
		const hi = q({
			id: "hi",
			interest: 1,
			importance: 1,
			createdAt: "2026-09-20T00:00:00Z",
		});
		const check = q({
			id: "chk",
			interest: 0,
			importance: 0,
			verify: true,
			createdAt: "2026-09-24T00:00:00Z",
		});
		const pick = (at: string) => {
			const c = selectQuestion([hi, check], [], cfg, () => 0.9, new Date(at));
			return "question" in c ? `${c.question.id}:${c.reason}` : "seed";
		};
		expect(pick("2026-09-25T00:00:00Z")).toBe("hi:score");
		expect(pick("2026-09-26T01:00:00Z")).toBe("chk:verify");
	});

	test("足どりを、次の一歩に書いた問い ID と照らす", () => {
		const log = [
			{
				event: "walked",
				questionId: "aaaaaaa2",
				question: "b",
				theme: "t",
				found: "none",
			},
			{ event: "walked", questionId: "aaaaaaa1", question: "a", theme: "t" },
			{ event: "reflected" },
			{ event: "walked", questionId: "old00000", question: "old", theme: "t" },
		];
		const t = walkTrail(log, [
			"[aaaaaaa1] を歩く",
			"91be18ca を確かめる",
			"ID の無い一歩",
		]);
		expect(
			t.steps.map((s) => `${s.questionId}:${s.result}:${s.promised}`),
		).toEqual(["aaaaaaa1:note:true", "aaaaaaa2:none:false"]);
		expect(t).toMatchObject({
			promised: ["aaaaaaa1", "91be18ca"],
			kept: ["aaaaaaa1"],
			unmatched: 1,
		});
	});

	test("個性の系統を selfBlindEvery 回歩くごとに 1 回、自己記述を渡さずに歩き、ノートに印を付ける", async () => {
		const store = freshStore();
		writeFileSync(
			join(store.home, "ashi.json"),
			JSON.stringify({ selfBlindEvery: 2, ownerShare: 0 }),
		);
		store.saveSelf("私は寄り道が好きな歩き手で、問いの連鎖を追うのが楽しい。");
		store.saveQuestions([
			q({ id: "s1", track: "self", theme: "a" }),
			q({ id: "s2", track: "self", theme: "b" }),
		]);
		const head = new FakeHead({ explore: () => explore() });
		for (let i = 0; i < 2; i++) {
			store.saveWalk({ ...store.walk(), sleepingUntil: undefined });
			await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
		}
		const systems = head.calls
			.filter((c) => c.task === "explore")
			.map((c) => c.system);
		expect(systems[0]).toContain("寄り道が好きな歩き手");
		expect(systems[1]).not.toContain("寄り道が好きな歩き手");
		expect(systems[1]).toContain("自己記述を渡していない");
		expect(store.notes().map((n) => Boolean(n.blind))).toEqual([false, true]);
	});
});

describe("Ashi の改善案(2026-09-26 午後)", () => {
	test("自己記述を書き直すたびに版を積み、最初の版とぼかしの数を内省に見せる", async () => {
		const store = freshStore(["a"]);
		store.saveSelf(
			"記録は誰が読むかで意味が変わるのかもしれない。たぶんそうだと思う。",
			new Date("2026-09-25T01:00:00Z"),
		);
		store.saveWalk({ ...store.walk(), steps: 4 });
		const head = new FakeHead({
			explore: () => explore(),
			reflect: () => ({
				...reflect(),
				self: "記録は必ず誰が読むかで意味が変わる。明らかにそうだ。",
				patterns: ["誰が読む", "独立"],
			}),
		});
		await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
		const prompt = head.calls.find((c) => c.task === "reflect")?.prompt ?? "";
		expect(prompt).toContain("自己記述の移り変わり");
		expect(prompt).toContain("のかもしれない");
		expect(store.selfHistory().map((v) => v.text.slice(0, 6))).toEqual([
			"記録は誰が読",
			"記録は必ず誰",
		]);
		const [first, second] = store.selfHistory().map((v) => hedgeStats(v.text));
		expect(first?.hedges).toBeGreaterThan(second?.hedges ?? 0);
		expect(second?.asserts).toBeGreaterThan(0);
		expect(store.walk().selfPatterns).toEqual(["誰が読む", "独立"]);
	});

	test("よそ者との会話で、自分の型の言葉を最初の返事で持ち込んだか、相手が先に言ったかを数える", () => {
		const turns = [
			{ by: "stranger" as const, text: "素数の分布は独立に見えて、実は…" },
			{ by: "ashi" as const, text: "独立に見えるかは、誰が測るかで変わりそう" },
			{ by: "stranger" as const, text: "共有された段の話?" },
		];
		expect(patternHits(turns, ["独立", "誰が測る", "共有"])).toEqual([
			{ word: "独立", firstReply: true, strangerFirst: true },
			{ word: "誰が測る", firstReply: true, strangerFirst: false },
		]);
	});
});
