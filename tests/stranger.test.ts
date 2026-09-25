import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeConfig } from "../src/lib/server/ashi/config.ts";
import { ownerPull } from "../src/lib/server/ashi/legs/guard.ts";
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
