import { describe, expect, test } from "bun:test";
import { chat, chatInFlight } from "../src/lib/server/ashi/legs/chat.ts";
import { markedClaims } from "../src/lib/server/ashi/legs/guard.ts";
import {
	mergeNews,
	newsBlock,
	refreshNews,
} from "../src/lib/server/ashi/legs/news.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
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

describe("話す: 画面を移っても消えない", () => {
	test("頭が考えている間は発言が見え、答えたら問いに加えたものごと保存される", async () => {
		const store = freshStore();
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const head = new FakeHead({
			chat: () => ({
				reply: "調べておくね",
				stances: [],
				unverified: [],
				new_questions: [
					{
						text: "台風の進路予報はどう作られるか",
						theme: "気象",
						track: "self",
						interest: 0.5,
						importance: 0.5,
						feasibility: 0.5,
					},
				],
				crawl: [],
			}),
		});
		const think = head.think.bind(head);
		head.think = (async (req) => {
			await gate;
			return think(req);
		}) as typeof head.think;
		const running = chat(
			{ store, head, tools: [], now: () => now },
			"持ち主",
			[],
			"台風どうだった?",
		);
		await Bun.sleep(10);
		expect(chatInFlight("持ち主")?.question).toBe("台風どうだった?");
		release();
		await running;
		expect(chatInFlight("持ち主")).toBeUndefined();
		expect(store.recentChats(1)[0]?.added).toEqual([
			"台風の進路予報はどう作られるか",
		]);
	});
});

describe("持ち主への訂正の台帳", () => {
	test("内省で気づいた訂正を溜め、話すときに先に出させ、伝えたら消す", async () => {
		const store = freshStore(["a"]);
		store.saveWalk({ ...store.walk(), steps: 4 });
		const walker = new FakeHead({
			explore: () => ({
				title: "t",
				summary: "s",
				findings: "f",
				answered: false,
				new_questions: [],
				tiredness: 0.2,
				sleep_minutes: 30,
			}),
			reflect: () => ({
				diary: "d",
				self: "私は寄り道が好きな歩き手で、問いの連鎖を追うのが楽しい。",
				next_steps: [],
				bridge_ideas: [],
				proposals: [],
				posts: [],
				merges: [],
				themes: [],
				owner_corrections: [
					"自分の話が報酬になる研究は追試で再現しなかった、と前に言い損ねた",
				],
			}),
		});
		await step({
			store,
			head: walker,
			tools: [],
			now: () => now,
			rng: () => 0.99,
		});
		const [c] = store.walk().ownerCorrections ?? [];
		expect(c?.text).toContain("追試で再現しなかった");
		const head = new FakeHead({
			chat: () => ({
				reply: "先に訂正です",
				stances: [],
				unverified: [],
				delivered_corrections: [c?.id],
				new_questions: [],
				crawl: [],
			}),
		});
		await chat(
			{ store, head, tools: [], now: () => now },
			"持ち主",
			[],
			"こんにちは",
		);
		expect(head.calls[0]?.prompt).toContain(
			"この訂正に関係するときに伝えてください",
		);
		expect(head.calls[0]?.prompt).toContain(c?.id ?? "?");
		expect(store.walk().ownerCorrections).toEqual([]);
	});

	test("印だけの文は直前の主張と合わせて 1 本にし、断った文は拾わない", () => {
		expect(
			markedClaims([
				"ハキリアリは、菌を枯らす葉を運ばなくなる回避学習をするらしい。うろ覚えだけど。確かめたことにしないでおくね。",
			]),
		).toEqual([
			"ハキリアリは、菌を枯らす葉を運ばなくなる回避学習をするらしい。うろ覚えだけど。",
		]);
	});
});

describe("止める", () => {
	test("持ち主が止めている間は、頭を呼ばずに休む", async () => {
		const store = freshStore(["a"]);
		store.saveWalk({
			...store.walk(),
			paused: { at: now.toISOString(), by: "持ち主" },
		});
		const head = new FakeHead({});
		const o = await step({ store, head, tools: [], now: () => now });
		expect(o.kind).toBe("paused");
		expect(head.calls).toHaveLength(0);
	});
});
