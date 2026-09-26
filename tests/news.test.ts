import { describe, expect, test } from "bun:test";
import { chat } from "../src/lib/server/ashi/legs/chat.ts";
import {
	mergeNews,
	newsBlock,
	refreshNews,
} from "../src/lib/server/ashi/legs/news.ts";
import { FakeHead, freshStore } from "./helpers.ts";

const now = new Date("2026-09-26T12:00:00+09:00");
const rss = (items: [string, string][]) =>
	`<?xml version="1.0"?><rss><channel>${items
		.map(([t, d]) => `<item><title>${t}</title><pubDate>${d}</pubDate></item>`)
		.join("")}</channel></rss>`;

describe("ニュースの見出しを目にしておく", () => {
	test("見出しを読み、間隔が来るまでは読み直さない", async () => {
		const store = freshStore();
		let hits = 0;
		const deps = {
			resolve: async () => ["93.184.216.34"],
			fetch: (async () => {
				hits++;
				return new Response(
					rss([["台風26号 沖縄に接近へ", "Sat, 26 Sep 2026 11:49:54 +0900"]]),
					{
						headers: { "content-type": "application/xml" },
					},
				);
			}) as unknown as typeof fetch,
		};
		const r = await refreshNews(store, now, deps);
		expect(r?.items[0]?.title).toBe("台風26号 沖縄に接近へ");
		const again = await refreshNews(
			store,
			new Date(now.getTime() + 3600e3),
			deps,
		);
		expect(again).toBeUndefined();
		expect(hits).toBe(2); // 配信元 2 つを 1 回ずつ
	});

	test("数日で忘れる。同じ見出しは重ねない", () => {
		const items = mergeNews(
			[
				{ title: "古い話", at: "2026-09-20T00:00:00Z", source: "nhk.or.jp" },
				{ title: "台風", at: "2026-09-25T00:00:00Z", source: "nhk.or.jp" },
			],
			[{ title: "台風", at: "2026-09-25T00:00:00Z", source: "yahoo.co.jp" }],
			now,
			{ keepDays: 3 },
		);
		expect(items.map((x) => x.title)).toEqual(["台風"]);
	});

	test("話すときに、見出しだけを見たことと、無いことは知らないことを添えて見せる", async () => {
		const store = freshStore();
		store.saveNews({
			lastAt: now.toISOString(),
			items: [
				{
					title: "台風26号 沖縄に接近へ",
					at: now.toISOString(),
					source: "nhk.or.jp",
				},
			],
		});
		const head = new FakeHead({
			chat: () => ({
				reply: "ね",
				stances: [],
				unverified: [],
				new_questions: [],
				crawl: [],
			}),
		});
		await chat(
			{ store, head, tools: [], now: () => now },
			"持ち主",
			[],
			"台風どうだった?",
		);
		const prompt = head.calls[0]?.prompt ?? "";
		expect(prompt).toContain("台風26号 沖縄に接近へ");
		expect(prompt).toContain("ここに無い出来事は知らない");
		expect(newsBlock([])).toContain("ニュースは目にしていない");
	});
});
