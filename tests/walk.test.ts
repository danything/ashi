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
		expect(head.calls[0]?.prompt).toContain("休ませているテーマ(a)以外");
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

describe("空の系統", () => {
	test("さいころで個性が出て個性の問いが無ければ、先回りに回さず個性の問いを探させる", async () => {
		const store = freshStore();
		store.saveQuestions([q({ track: "owner", text: "先回りの問い" })]);
		const head = new FakeHead({
			seed: (req) => {
				expect(req.prompt).toContain("個性(self)の問いが尽きました");
				return {
					// 頭が owner を付けてきても、探させた系統(self)に揃える
					new_questions: [
						{
							text: "葦はなぜ折れにくい",
							theme: "植物",
							track: "owner",
							interest: 1,
							importance: 1,
							feasibility: 1,
						},
					],
					crawl: [],
					tiredness: 0,
					sleep_minutes: 20,
				};
			},
		});
		const o = await step({
			store,
			head,
			tools: [],
			now: () => new Date("2026-09-25T12:00:00"),
			rng: () => 0.99,
		});
		expect(o).toMatchObject({ kind: "seeded", track: "self", added: 1 });
		expect(head.calls.map((c) => c.task)).toEqual(["seed"]);
		expect(
			store.questions().find((x) => x.text === "葦はなぜ折れにくい")?.track,
		).toBe("self");
	});
});

describe("橋渡し", () => {
	test("個性の問いを歩いたら橋渡しを頼み、生まれた先回りの問いは元の問いを親に持つ", async () => {
		const store = freshStore();
		const selfQ = q({ track: "self", text: "イルカの片半球睡眠" });
		store.saveQuestions([selfQ]);
		const head = new FakeHead({
			explore: (req) => {
				expect(req.prompt).toContain("橋渡し");
				return explore({
					new_questions: [
						{
							text: "常駐エージェントは一部だけ休ませて見張りを残せるか",
							theme: "自律エージェント",
							track: "owner",
							interest: 0.8,
							importance: 0.8,
							feasibility: 0.8,
						},
						{
							text: "鳥の渡りと睡眠",
							theme: "睡眠の生物学",
							track: "self",
							interest: 0.8,
							importance: 0.5,
							feasibility: 0.8,
						},
					],
				});
			},
		});
		await step({
			store,
			head,
			tools: [],
			now: () => new Date("2026-09-25T12:00:00"),
			rng: () => 0.99,
		});
		const bridge = store
			.questions()
			.find((x) => x.text.startsWith("常駐エージェント"));
		expect(bridge).toMatchObject({ track: "owner", parentId: selfQ.id });
		const log = store.recentLog(5).find((e) => e.event === "walked");
		expect(log?.bridged).toEqual([
			"常駐エージェントは一部だけ休ませて見張りを残せるか",
		]);
	});

	test("先回りの問いを歩いたときは橋渡しを頼まない", async () => {
		const store = freshStore();
		store.saveQuestions([q({ track: "owner" })]);
		const head = new FakeHead({
			explore: (req) => {
				expect(req.prompt).not.toContain("橋渡し");
				return explore();
			},
		});
		await step({
			store,
			head,
			tools: [],
			now: () => new Date("2026-09-25T12:00:00"),
			rng: () => 0.1,
		});
		expect(head.calls).toHaveLength(1);
	});

	test("個性の問いを探させるときは、地図の一歩外から", async () => {
		const store = freshStore();
		const head = new FakeHead({
			seed: (req) => {
				expect(req.prompt).toContain("一歩外れた");
				expect(req.system).toContain("橋渡し");
				return {
					new_questions: [],
					crawl: [],
					tiredness: 0,
					sleep_minutes: 20,
				};
			},
		});
		await step({
			store,
			head,
			tools: [],
			now: () => new Date("2026-09-25T12:00:00"),
			rng: () => 0.99,
		});
		expect(head.calls).toHaveLength(1);
	});
});

describe("改善案", () => {
	test("内省で出た改善案を残し、足どりに書く", async () => {
		const store = freshStore(["a"]);
		store.saveWalk({ ...store.walk(), steps: 4 });
		const head = new FakeHead({
			explore: () => explore(),
			reflect: (req) => {
				expect(req.prompt).toContain("proposals");
				return {
					diary: "歩いた",
					self: "私は寄り道が好きな歩き手で、問いの連鎖を追うのが楽しい。",
					proposals: [
						{
							title: "読みたい論文が有料で読めない",
							why: "IEEE で止まった",
							idea: "arXiv を先に探す",
						},
					],
				};
			},
		});
		await step({
			store,
			head,
			tools: [],
			now: () => new Date("2026-09-25T12:00:00"),
			rng: () => 0.99,
		});
		expect(store.proposals()[0]).toMatchObject({
			title: "読みたい論文が有料で読めない",
			status: "open",
			count: 1,
		});
		expect(
			store.recentLog(5).find((e) => e.event === "reflected")?.proposed,
		).toEqual(["読みたい論文が有料で読めない"]);
	});
});

describe("Ashi の改善案への対応(2026-09-25)", () => {
	const at2 = () => new Date("2026-09-25T12:00:00");

	test("2 回見つからなかった問いは未測定の棚へ。探した場所は次の歩みに見せる", async () => {
		const store = freshStore();
		const target = q({ track: "self", text: "脳幹の温度", theme: "睡眠" });
		store.saveQuestions([target]);
		const miss = (where: string) =>
			new FakeHead({
				explore: () =>
					explore({ found: "none", searched: [where], answered: false }),
			});

		await step({
			store,
			head: miss("PubMed 脳幹 温度"),
			tools: [],
			now: at2,
			rng: () => 0.99,
		});
		let got = store.questions().find((x) => x.id === target.id);
		expect(got).toMatchObject({
			status: "open",
			misses: 1,
			searchedWhere: ["PubMed 脳幹 温度"],
		});

		store.saveWalk({ ...store.walk(), sleepingUntil: undefined });
		const second = new FakeHead({
			explore: (req) => {
				expect(req.prompt).toContain("これまでに探した場所");
				expect(req.prompt).toContain("PubMed 脳幹 温度");
				return explore({
					found: "none",
					searched: ["Google Scholar"],
					answered: false,
				});
			},
		});
		await step({ store, head: second, tools: [], now: at2, rng: () => 0.99 });
		got = store.questions().find((x) => x.id === target.id);
		expect(got?.status).toBe("parked");
		expect(store.recentLog(3).find((e) => e.event === "walked")?.parked).toBe(
			true,
		);
	});

	test("内省の次の一歩と橋の候補を残し、次の歩みに見せる。これまでの改善案も内省に見せる", async () => {
		const store = freshStore(["a"]);
		store.saveProposals([
			{
				id: "p1",
				title: "偏りを抑えて",
				why: "",
				idea: "",
				status: "done",
				count: 1,
				createdAt: "",
				lastAt: "",
			},
		]);
		store.saveWalk({ ...store.walk(), steps: 4 });
		const head = new FakeHead({
			explore: () => explore(),
			reflect: (req) => {
				expect(req.prompt).toContain("偏りを抑えて(直った)");
				return {
					diary: "d",
					self: "私は寄り道が好きな歩き手で、問いの連鎖を追うのが楽しい。",
					next_steps: ["次の先回りは中古車の周辺法規から"],
					bridge_ideas: [
						{ to_theme: "稼働表", idea: "空白は休憩かもしれない(推測)" },
					],
					proposals: [],
				};
			},
		});
		await step({ store, head, tools: [], now: at2, rng: () => 0.99 });
		expect(store.walk().intentions).toEqual([
			"次の先回りは中古車の周辺法規から",
		]);
		expect(store.bridgeIdeas()[0]).toMatchObject({
			toTheme: "稼働表",
			idea: "空白は休憩かもしれない(推測)",
		});

		store.saveQuestions([q({ track: "owner", theme: "稼働表" })]);
		store.saveWalk({ ...store.walk(), sleepingUntil: undefined });
		const next = new FakeHead({
			explore: (req) => {
				expect(req.prompt).toContain("次の先回りは中古車の周辺法規から");
				expect(req.prompt).toContain("空白は休憩かもしれない");
				expect(req.prompt).toContain("問いを選ぶのは足です");
				return explore();
			},
		});
		await step({ store, head: next, tools: [], now: at2, rng: () => 0.1 });
		expect(next.calls).toHaveLength(1);
	});

	test("直近に多く歩いたテーマの問いは選ばず、それ以外の問いを探させる", async () => {
		const store = freshStore();
		store.saveQuestions([q({ track: "owner", theme: "稼働表" })]);
		store.saveWalk({
			...store.walk(),
			recentThemes: ["稼働表", "睡眠", "稼働表", "年輪", "稼働表"],
		});
		const head = new FakeHead({
			seed: (req) => {
				expect(req.prompt).toContain("休ませているテーマ(稼働表)以外");
				expect(req.prompt).toContain("直近の内訳にまだ出てこない項目を優先");
				return {
					new_questions: [
						{
							text: "また稼働表",
							theme: "稼働表",
							track: "owner",
							interest: 1,
							importance: 1,
							feasibility: 1,
						},
						{
							text: "中古車の周辺法規",
							theme: "中古車",
							track: "owner",
							interest: 1,
							importance: 1,
							feasibility: 1,
						},
					],
					crawl: [],
					tiredness: 0,
					sleep_minutes: 20,
				};
			},
		});
		const o = await step({ store, head, tools: [], now: at2, rng: () => 0.1 });
		expect(o).toMatchObject({ kind: "seeded", track: "owner", added: 1 });
		expect(store.questions().map((x) => x.text)).toContain("中古車の周辺法規");
	});
});

describe("学びのリセット", () => {
	test("学びを archive に移して白紙に戻し、持ち主の地図・材料・改善案・コア原則の承認は残す", async () => {
		const store = freshStore(["a"]);
		await step({
			store,
			head: new FakeHead({ explore: () => explore() }),
			tools: [],
			now: at,
			rng: noDetour,
		});
		store.saveOwner("# 地図\\n\\n持ち主は k3s を触っている。");
		store.addSource(
			{ id: newId(), title: "ブログ", kind: "paste", createdAt: "" },
			"本文",
		);
		store.saveProposals([
			{
				id: "p",
				title: "t",
				why: "",
				idea: "",
				status: "done",
				count: 1,
				createdAt: "",
				lastAt: "",
			},
		]);
		store.saveBridgeIdeas([
			{ id: "b", toTheme: "x", idea: "y", createdAt: "" },
		]);
		const coreHash = store.walk().coreHash;
		expect(store.notes()).toHaveLength(1);

		const dir = store.resetLearning(new Date("2026-09-25T12:00:00Z"));
		expect(dir).toBe("archive/2026-09-25T12-00-00-000Z");
		expect(store.notes()).toEqual([]);
		expect(store.questions()).toEqual([]);
		expect(store.bridgeIdeas()).toEqual([]);
		expect(store.self()).toContain("まだ歩き始めていない");
		expect(store.walk()).toMatchObject({
			steps: 0,
			recentThemes: [],
			coreHash,
		});
		expect(store.owner()).toContain("k3s");
		expect(store.sources()).toHaveLength(1);
		expect(store.proposals()).toHaveLength(1);
		// 前の学びは archive にある
		expect(JSON.parse(store.readText(`${dir}/notes.json`))).toHaveLength(1);
		expect(store.recentLog(1)[0]?.event).toBe("reset");
	});
});
