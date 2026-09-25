import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeConfig } from "../src/lib/server/ashi/config.ts";
import {
	ownerPull,
	strangerLanding,
} from "../src/lib/server/ashi/legs/guard.ts";
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
		expect(strangerLanding(qs, [])).toEqual({ home: 1, total: 2 });
	});
});
