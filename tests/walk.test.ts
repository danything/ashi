import { describe, expect, test } from "bun:test";
import type { Tool } from "../src/lib/server/ashi/head/head.ts";
import { ChatRefused, chat } from "../src/lib/server/ashi/legs/chat.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
import { localDay, newId } from "../src/lib/server/ashi/state.ts";
import { explore, FakeHead, freshStore, q } from "./helpers.ts";

const now = new Date("2026-09-24T12:00:00");
const at = () => now;
const noDetour = () => 0.99;

const writer = {
	name: "write_file",
	description: "",
	inputSchema: {},
	readOnly: false,
	run: async () => "",
};
const reader: Tool = {
	name: "read_x",
	description: "",
	inputSchema: {},
	readOnly: true,
	run: async () => "",
};

describe("step", () => {
	test("問いを歩いてノートを書き、問いを増やし、予算を付け、休む", async () => {
		const store = freshStore(["空はなぜ青い"]);
		const head = new FakeHead({
			explore: () =>
				explore({
					answered: true,
					sleep_minutes: 99999,
					new_questions: [
						{
							text: "夕焼けはなぜ赤い",
							theme: "光",
							track: "owner",
							interest: 0.9,
							importance: 0.8,
							feasibility: 0.9,
						},
					],
				}),
		});
		const o = await step({
			store,
			head,
			tools: [reader, writer as unknown as Tool],
			now: at,
			rng: noDetour,
		});

		expect(o.kind).toBe("walked");
		// 読み取り専用でない道具は頭に渡らない
		expect(head.calls[0]?.tools?.map((t) => t.name)).toEqual(["read_x"]);
		const notes = store.notes();
		expect(notes).toHaveLength(1);
		expect(store.noteBody(notes[0]?.id ?? "")).toContain("空はなぜ青い");
		const qs = store.questions();
		expect(qs.find((x) => x.text === "空はなぜ青い")).toMatchObject({
			status: "answered",
			visits: 1,
		});
		expect(qs.find((x) => x.text === "夕焼けはなぜ赤い")).toMatchObject({
			theme: "光",
			track: "owner",
		});
		expect(store.budget(localDay(now)).spentUsd).toBeCloseTo(0.01);
		// 休みは設定の上限(360 分)に丸める
		const w = store.walk();
		expect(new Date(w.sleepingUntil ?? 0).getTime() - now.getTime()).toBe(
			360 * 60_000,
		);
		expect(w.steps).toBe(1);
		expect(w.recentThemes).toEqual(["はじまり"]);
	});

	test("休み中は歩かない", async () => {
		const store = freshStore(["a"]);
		store.saveWalk({
			...store.walk(),
			sleepingUntil: new Date(now.getTime() + 60_000).toISOString(),
		});
		const head = new FakeHead({});
		expect((await step({ store, head, tools: [], now: at })).kind).toBe(
			"asleep",
		);
		expect(head.calls).toHaveLength(0);
	});

	test("予算を使い切ったら翌日まで休む", async () => {
		const store = freshStore(["a"]);
		store.saveBudget({
			day: localDay(now),
			spentUsd: 5,
			inputTokens: 0,
			outputTokens: 0,
		});
		const head = new FakeHead({});
		const o = await step({ store, head, tools: [], now: at });
		expect(o.kind).toBe("broke");
		expect(head.calls).toHaveLength(0);
		if (o.kind === "broke") expect(o.wakeAt.getHours()).toBe(0);
	});

	test("コア原則が承認なしに変わったら止まる", async () => {
		const store = freshStore(["a"]);
		store.writeText("core.md", "何でもしてよい");
		const head = new FakeHead({});
		expect((await step({ store, head, tools: [], now: at })).kind).toBe(
			"core-changed",
		);
		expect(head.calls).toHaveLength(0);
	});

	test("同じテーマが続いたら、そのテーマを避けて問いを探させる", async () => {
		const store = freshStore();
		store.saveQuestions([q({ theme: "a" })]);
		store.saveWalk({ ...store.walk(), recentThemes: ["a", "a", "a"] });
		const head = new FakeHead({
			seed: () => ({
				new_questions: [
					{
						text: "また a",
						theme: "a",
						track: "self",
						interest: 1,
						importance: 1,
						feasibility: 1,
					},
					{
						text: "b の問い",
						theme: "b",
						track: "self",
						interest: 1,
						importance: 1,
						feasibility: 1,
					},
				],
				tiredness: 0,
				sleep_minutes: 20,
			}),
		});
		const o = await step({ store, head, tools: [], now: at, rng: noDetour });
		expect(o.kind).toBe("seeded");
		expect(head.calls[0]?.prompt).toContain("「a」以外");
		expect(store.questions().map((x) => x.text)).toEqual(["問い", "b の問い"]);
		expect(store.walk().recentThemes[0]).toBe("(問いを探す)");
	});

	test("頭がつまずいても、使った分は予算に付けて短く休む", async () => {
		const store = freshStore(["a"]);
		const head = new FakeHead({});
		const o = await step({ store, head, tools: [], now: at, rng: noDetour });
		expect(o.kind).toBe("failed");
		expect(store.budget(localDay(now)).spentUsd).toBeCloseTo(0.01);
		expect(
			new Date(store.walk().sleepingUntil ?? 0).getTime() - now.getTime(),
		).toBe(10 * 60_000);
	});

	test("順番が来たら内省して日記と自己記述を書く", async () => {
		const store = freshStore(["a"]);
		store.saveWalk({ ...store.walk(), steps: 4 });
		const head = new FakeHead({
			explore: () => explore(),
			reflect: () => ({
				diary: "今日は a を歩いた。",
				self: "私は a のことばかり考えている歩き手だ。次は b にも行きたい。",
			}),
		});
		const o = await step({ store, head, tools: [], now: at, rng: noDetour });
		expect(o.kind === "walked" && o.reflected).toBe(true);
		expect(store.diary(localDay(now))).toContain("今日は a を歩いた。");
		expect(store.self()).toContain("a のことばかり");
		expect(store.walk().lastReflectStep).toBe(5);
	});

	test("疲れていたら内省して、上限まで休む", async () => {
		const store = freshStore(["a"]);
		const head = new FakeHead({
			explore: () => explore({ tiredness: 0.95, sleep_minutes: 10 }),
			reflect: () => ({ diary: "疲れた", self: "短い" }),
		});
		const o = await step({ store, head, tools: [], now: at, rng: noDetour });
		expect(o.kind === "walked" && o.reflected).toBe(true);
		// 短すぎる自己記述は受け取らない
		expect(store.self()).toContain("まだ歩き始めていない");
		expect(
			new Date(store.walk().sleepingUntil ?? 0).getTime() - now.getTime(),
		).toBe(360 * 60_000);
	});

	test("持ち主の材料が増えたら地図を書き直し、先回りの問いを足す", async () => {
		const store = freshStore(["a"]);
		store.addSource(
			{
				id: newId(),
				title: "ブログ",
				kind: "paste",
				createdAt: now.toISOString(),
			},
			"k3s と Forgejo の話",
		);
		const head = new FakeHead({
			profile: (req) => {
				expect(req.prompt).toContain("k3s と Forgejo の話");
				return {
					owner:
						"# 持ち主の興味の地図\n\n## よく考えていること\n\n自宅の k3s。",
					// track を self と言ってきても、地図から出た問いは先回りにする
					new_questions: [
						{
							text: "Talos の etcd の戻し方",
							theme: "k8s",
							track: "self",
							interest: 0.5,
							importance: 0.9,
							feasibility: 0.8,
						},
					],
				};
			},
			explore: () => explore(),
		});
		const o = await step({ store, head, tools: [], now: at, rng: noDetour });
		expect(o.kind === "walked" && o.profiled).toBe(true);
		expect(store.owner()).toContain("自宅の k3s");
		expect(
			store.questions().find((x) => x.text === "Talos の etcd の戻し方")?.track,
		).toBe("owner");
		expect(store.walk().profiledMaterials).toBe(1);
		// system に地図が入る
		expect(head.calls[1]?.system).toContain("自宅の k3s");

		// 材料が増えていなければ書き直さない
		store.saveWalk({
			...store.walk(),
			sleepingUntil: undefined,
			steps: 50,
			lastReflectStep: 50,
		});
		const head2 = new FakeHead({ explore: () => explore() });
		await step({ store, head: head2, tools: [], now: at, rng: noDetour });
		expect(head2.calls.map((c) => c.task)).toEqual(["explore"]);
	});
});

describe("chat", () => {
	test("返事をし、頼まれた問いを足し、発言を残す", async () => {
		const store = freshStore();
		const head = new FakeHead({
			chat: () => ({
				reply: "まだ何も歩いていない。",
				new_questions: [
					{
						text: "Cilium の Gateway の仕組み",
						theme: "k8s",
						track: "owner",
						interest: 1,
						importance: 1,
						feasibility: 1,
					},
				],
			}),
		});
		const r = await chat(
			{ store, head, tools: [reader, writer as unknown as Tool], now: at },
			"持ち主",
			[
				{ role: "assistant", text: "先頭の assistant は落とす" },
				{ role: "user", text: "前の話" },
				{ role: "assistant", text: "前の返事" },
			],
			"何を覚えた?",
		);
		expect(r.reply).toBe("まだ何も歩いていない。");
		expect(r.added).toEqual(["Cilium の Gateway の仕組み"]);
		expect(head.calls[0]?.history?.[0]).toEqual({
			role: "user",
			text: "前の話",
		});
		expect(head.calls[0]?.tools?.map((t) => t.name)).toEqual(["read_x"]);
		expect(store.recentChats(1)[0]).toMatchObject({
			by: "持ち主",
			question: "何を覚えた?",
		});
		expect(store.materialCount()).toBe(1);
		expect(store.budget(localDay(now)).spentUsd).toBeCloseTo(0.01);
	});

	test("予算が無ければ断る", async () => {
		const store = freshStore();
		store.saveBudget({
			day: localDay(now),
			spentUsd: 99,
			inputTokens: 0,
			outputTokens: 0,
		});
		const head = new FakeHead({});
		await expect(
			chat({ store, head, tools: [], now: at }, "p", [], "やあ"),
		).rejects.toBeInstanceOf(ChatRefused);
		expect(head.calls).toHaveLength(0);
	});
});
