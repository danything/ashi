import { describe, expect, test } from "bun:test";
import { chat } from "../src/lib/server/ashi/legs/chat.ts";
import {
	addPhrases,
	lintReply,
	phraseLedger,
	SEED_PHRASES,
} from "../src/lib/server/ashi/legs/style.ts";
import { FakeHead, freshStore } from "./helpers.ts";

const now = new Date("2026-10-10T03:00:00Z");

describe("lintReply", () => {
	const phrases = ["大事な", "筋が通って", "聞かせてください"];

	test("冒頭の持ち上げ・言い回しの使いすぎ・見出し・太字を数える", () => {
		const r = lintReply(
			"大事な答えだと思います。\n## 見出し\n**一つ**と**二つ**。筋が通っています。筋が通っています。",
			phrases,
			[],
		);
		expect(r.some((x) => x.startsWith("冒頭の文で"))).toBe(true);
		expect(r.some((x) => x.includes("3 回使っている"))).toBe(true);
		expect(r).toContain("見出しを使っている(会話は平文)");
		expect(r).toContain("太字が 2 か所(1 か所まで)");
	});

	test("文末のぼかしが 4 割以上なら当たる。(推測) を付けて言い切った文は数えない", () => {
		const hedgy =
			"雨だと思います。風かもしれません。寒いでしょう。暖かいです。晴れです。";
		expect(lintReply(hedgy, [], []).join()).toContain("3 / 5");
		const plain =
			"雨です(推測)。風です。寒いです。暖かいです。晴れだと思います。";
		expect(lintReply(plain, [], [])).toEqual([]);
	});

	test("質問で終わる返事が 3 回続いたら当たる", () => {
		expect(lintReply("どう?", [], ["どうですか?", "教えてください。"])).toEqual(
			[
				"質問や「〜ください」で終わる返事が 3 回続いている。今回は質問で締めない",
			],
		);
		expect(lintReply("どう?", [], ["そうです。", "教えてください。"])).toEqual(
			[],
		);
	});
});

describe("台帳", () => {
	test("最初は Ashi が挙げた言い回しで、持ち主の指摘を重ねずに足す", () => {
		const store = freshStore();
		expect(phraseLedger(store).map((p) => p.text)).toEqual(SEED_PHRASES);
		expect(
			addPhrases(store, ["一段正確に", "大事な", " ", 3], "owner", now),
		).toEqual(["一段正確に"]);
		expect(phraseLedger(store).at(-1)).toMatchObject({
			text: "一段正確に",
			from: "owner",
		});
	});
});

describe("持ち主との対話の書き方", () => {
	test("リンタに当たった返事は中身を変えずに 1 回書き直し、指摘された言い回しと頼まれた改善案を積む", async () => {
		const store = freshStore();
		const head = new FakeHead({
			chat: (req) => {
				expect(req.prompt).toContain("平文で書く");
				expect(req.prompt).toContain("「聞かせてください」");
				return {
					reply: "大事な答えだと思います。中身はこうです。",
					new_questions: [],
					crawl: [],
					flagged_phrases: ["一段正確に"],
					proposals: [
						{
							title: "会話の返事を平文に",
							why: "見出しが多い",
							idea: "型を変える",
						},
					],
				};
			},
			"chat-rewrite": (req) => {
				expect(req.prompt).toContain("冒頭の文で");
				return { reply: "中身はこうです。" };
			},
		});
		const r = await chat(
			{ store, head, tools: [], now: () => now },
			"持ち主",
			[],
			"Claude っぽい言い回し減らせない?一段正確にってやつ",
		);
		expect(r.reply).toBe("中身はこうです。");
		expect(head.calls.map((c) => c.task)).toEqual(["chat", "chat-rewrite"]);
		expect(store.recentChats(1)[0]).toMatchObject({
			reply: "中身はこうです。",
			rewritten: true,
		});
		expect(phraseLedger(store).map((p) => p.text)).toContain("一段正確に");
		expect(store.proposals().map((p) => p.title)).toEqual([
			"会話の返事を平文に",
		]);
	});

	test("当たらなければ書き直さない", async () => {
		const store = freshStore();
		const head = new FakeHead({
			chat: () => ({ reply: "晴れです。", new_questions: [], crawl: [] }),
		});
		await chat(
			{ store, head, tools: [], now: () => now },
			"持ち主",
			[],
			"天気は",
		);
		expect(head.calls.map((c) => c.task)).toEqual(["chat"]);
	});
});
