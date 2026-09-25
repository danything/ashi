import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { claudeBlockage } from "../src/lib/server/ashi/head/claude.ts";
import { HeadAccessError } from "../src/lib/server/ashi/head/head.ts";
import {
	fetchBlockage,
	openBlockers,
	raiseBlocker,
	resolveBlockers,
} from "../src/lib/server/ashi/legs/blockers.ts";
import { chat } from "../src/lib/server/ashi/legs/chat.ts";
import { crawlRequested } from "../src/lib/server/ashi/legs/feeds.ts";
import { reportedBlocks, step } from "../src/lib/server/ashi/legs/walk.ts";
import {
	CHAT_SCHEMA,
	DIALOGUE_FINAL_SCHEMA,
	DIALOGUE_REPLY_SCHEMA,
	EXPLORE_SCHEMA,
	PROFILE_SCHEMA,
	REFLECT_SCHEMA,
	SEED_SCHEMA,
	STRANGER_SCHEMA,
} from "../src/lib/server/ashi/prompts.ts";
import { explore, FakeHead, freshStore } from "./helpers.ts";

const now = new Date("2026-09-24T12:00:00");

const collector = () => {
	const sent: string[] = [];
	return { sent, notify: async (t: string) => void sent.push(t) };
};

describe("raiseBlocker", () => {
	test("初めてのときだけ知らせ、片づいた後にまた起きたらまた知らせる", async () => {
		const store = freshStore();
		const { sent, notify } = collector();
		const b = { key: "feed:x", title: "X を読む鍵が無い", remedy: "鍵を作る" };
		expect(await raiseBlocker(store, "feed", b, now, notify)).toBe(true);
		expect(await raiseBlocker(store, "feed", b, now, notify)).toBe(false);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("鍵を作る");
		expect(openBlockers(store)[0]?.count).toBe(2);

		resolveBlockers(store, "feed:x", now);
		expect(openBlockers(store)).toHaveLength(0);
		await raiseBlocker(store, "feed", b, now, notify);
		expect(sent).toHaveLength(2);
		expect(openBlockers(store)[0]?.count).toBe(1);
	});
});

describe("claudeBlockage", () => {
	const err = (status: number, message: string) =>
		Anthropic.APIError.generate(
			status,
			{ error: { message } },
			message,
			new Headers(),
		);
	test("鍵・残高・web 検索・権限を、人が直せる形に", () => {
		expect(claudeBlockage(err(401, "invalid x-api-key"))?.key).toBe(
			"head:auth",
		);
		expect(
			claudeBlockage(err(400, "Your credit balance is too low"))?.key,
		).toBe("head:billing");
		expect(
			claudeBlockage(
				err(400, "web search is not enabled for this organization"),
			)?.key,
		).toBe("head:web-search");
		expect(claudeBlockage(err(403, "model not allowed"))?.key).toBe(
			"head:permission",
		);
		expect(claudeBlockage(err(500, "overloaded"))).toBeUndefined();
		expect(claudeBlockage(new Error("x"))).toBeUndefined();
	});
});

describe("step と弾かれたこと", () => {
	test("頭の鍵が通らなければ知らせ、答えられたら片づける", async () => {
		const store = freshStore(["a"]);
		const { sent, notify } = collector();
		const bad = {
			name: "bad",
			think: async () => {
				throw new HeadAccessError(
					"鍵",
					{ inputTokens: 0, outputTokens: 0, costUsd: 0 },
					{
						key: "head:auth",
						title: "Claude API の鍵が通らない",
						remedy: "ANTHROPIC_API_KEY",
					},
				);
			},
		};
		expect(
			(await step({ store, head: bad, tools: [], now: () => now, notify }))
				.kind,
		).toBe("failed");
		expect(sent[0]).toContain("Claude API の鍵が通らない");
		expect(openBlockers(store).map((b) => b.key)).toEqual(["head:auth"]);

		store.saveWalk({ ...store.walk(), sleepingUntil: undefined });
		const good = new FakeHead({ explore: () => explore() });
		await step({
			store,
			head: good,
			tools: [],
			now: () => now,
			rng: () => 0.99,
			notify,
		});
		expect(openBlockers(store)).toHaveLength(0);
	});

	test("頭が歩いていて弾かれたと知らせてきたら、画面に出す(通知はしない)", async () => {
		const store = freshStore(["a"]);
		const { sent, notify } = collector();
		const head = new FakeHead({
			explore: () =>
				explore({
					blocked: [
						{
							target: "IEEE Xplore",
							reason: "論文の本文が有料",
							needed: "機関の購読か、著者の公開版の URL を教える",
						},
					],
				}),
		});
		await step({
			store,
			head,
			tools: [],
			now: () => now,
			rng: () => 0.99,
			notify,
		});
		expect(openBlockers(store)[0]).toMatchObject({
			key: "report:ieee xplore",
			source: "report",
		});
		// 画面には出すが、通知はしない(有料の論文や判例誌のたびに鳴っていた)
		expect(sent).toEqual([]);
		expect(openBlockers(store)[0]?.remedy).toContain("著者の公開版");
	});

	test("reportedBlocks は形の違うものを落とし、3 件まで", () => {
		expect(reportedBlocks("x")).toEqual([]);
		expect(
			reportedBlocks([{ target: "", needed: "a" }, { target: 1 }]),
		).toEqual([]);
		expect(
			reportedBlocks(
				Array.from({ length: 5 }, (_, i) => ({
					target: `t${i}`,
					reason: "",
					needed: "n",
				})),
			),
		).toHaveLength(3);
	});
});

describe("巡回と弾かれたこと", () => {
	test("X の鍵が無ければ直し方つきで知らせる", async () => {
		const store = freshStore();
		store.writeText(
			"ashi.json",
			JSON.stringify({ feeds: [{ id: "x", kind: "x", target: "me" }] }),
		);
		const { sent, notify } = collector();
		await crawlRequested(store, ["x"], now, {}, {}, notify);
		expect(openBlockers(store)[0]?.title).toBe("X を読む鍵が無い");
		expect(sent[0]).toContain("developer.x.com");
	});
});

describe("fetchBlockage", () => {
	test("ログインや締め出しは知らせ、それ以外の失敗は知らせない", () => {
		expect(fetchBlockage("example.com", 403)?.key).toBe("fetch:example.com");
		expect(fetchBlockage("example.com", 404)).toBeUndefined();
		expect(fetchBlockage("", "private")?.key).toBe("fetch:private");
	});
});

describe("chat と弾かれたこと", () => {
	test("いま弾かれていることを頭に見せる", async () => {
		const store = freshStore();
		await raiseBlocker(
			store,
			"feed",
			{ key: "feed:x", title: "X を読む鍵が無い", remedy: "r" },
			now,
			async () => {},
		);
		const head = new FakeHead({
			chat: () => ({ reply: "X の鍵が無い", new_questions: [], crawl: [] }),
		});
		await chat(
			{ store, head, tools: [], now: () => now },
			"p",
			[],
			"何か困ってる?",
		);
		expect(head.calls[0]?.prompt).toContain("X を読む鍵が無い(1 回)");
	});
});

describe("答えの形", () => {
	test.each([
		["explore", EXPLORE_SCHEMA, ["crawl", "blocked"]],
		["seed", SEED_SCHEMA, ["crawl"]],
		["chat", CHAT_SCHEMA, ["crawl"]],
		["reflect", REFLECT_SCHEMA, []],
		["profile", PROFILE_SCHEMA, []],
		["stranger", STRANGER_SCHEMA, ["reply"]],
		["dialogue", DIALOGUE_REPLY_SCHEMA, ["reply"]],
		["dialogue-final", DIALOGUE_FINAL_SCHEMA, ["new_questions", "takeaway"]],
	] as const)(
		"%s: required と properties が揃い、要る欄がある",
		(_, schema, must) => {
			const props = Object.keys(schema.properties as object).sort();
			expect([...(schema.required as string[])].sort()).toEqual(props);
			for (const m of must) expect(props).toContain(m);
			expect(schema.additionalProperties).toBe(false);
		},
	);
});

test("サブスクのトークンが入っていたら、そう言う", () => {
	const prev = process.env.ANTHROPIC_API_KEY;
	process.env.ANTHROPIC_API_KEY = "sk-ant-oat01-xxxx";
	try {
		const e = Anthropic.APIError.generate(
			401,
			{ error: { message: "API key is invalid." } },
			"invalid",
			new Headers(),
		);
		expect(claudeBlockage(e)?.title).toContain("サブスク");
	} finally {
		if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
		else process.env.ANTHROPIC_API_KEY = prev;
	}
});
