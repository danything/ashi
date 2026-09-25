import { describe, expect, test } from "bun:test";
import {
	parseArchive,
	runCleanup,
	startCleanup,
} from "../src/lib/server/ashi/legs/x-cleanup.ts";
import { freshStore } from "./helpers.ts";

const now = new Date("2026-09-25T12:00:00Z");
const env = { X_CLIENT_ID: "cid", X_CLIENT_SECRET: "sec" };

const ARCHIVE = `window.YTD.tweets.part0 = ${JSON.stringify([
	{
		tweet: {
			id_str: "1",
			created_at: "Sat Aug 09 10:00:00 +0000 2026",
			full_text: "エンコードが終わりました: A",
		},
	},
	{
		tweet: {
			id_str: "2",
			created_at: "Fri Aug 08 10:00:00 +0000 2026",
			full_text: "エンコードが終わりました: B",
		},
	},
	{
		tweet: {
			id_str: "3",
			created_at: "Thu Sep 25 13:00:00 +0000 2026",
			full_text: "Ashi の投稿(つないだ後)",
		},
	},
	{
		tweet: {
			id_str: "4",
			created_at: "Sat Aug 09 10:00:00 +0000 2026",
			full_text: "残しておく",
		},
	},
])}`;

function connect(store: ReturnType<typeof freshStore>) {
	store.saveXAccount({
		userId: "u",
		username: "DoanyBot",
		accessToken: "at",
		refreshToken: "rt",
		expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
		connectedAt: "2026-09-25T01:39:25Z",
	});
}

describe("parseArchive", () => {
	test("つないだ後の投稿と、残すものを外す", () => {
		expect(
			parseArchive(ARCHIVE, new Date("2026-09-25T01:39:25Z"), new Set(["4"])),
		).toEqual(["1", "2"]);
	});
	test("tweets.js の形でなければ断る", () => {
		expect(() => parseArchive("hello", now, new Set())).toThrow("tweets.js");
	});
});

describe("runCleanup", () => {
	test("50 件ずつ消し、404 は消えたものとして数え、429 ならそこで止めて次に回す", async () => {
		const store = freshStore();
		connect(store);
		const ids = Array.from({ length: 60 }, (_, i) => String(i + 1));
		startCleanup(store, ids, now);
		const hits: string[] = [];
		let n = 0;
		const f = (async (u: string, init: RequestInit) => {
			hits.push(`${init.method} ${u.replace("https://api.x.com/2/", "")}`);
			n++;
			if (n === 2) return new Response("gone", { status: 404 });
			return Response.json({ data: { deleted: true } });
		}) as unknown as typeof fetch;
		const r = await runCleanup(store, now, env, f);
		expect(r).toEqual({ deleted: 49, left: 10 });
		expect(hits[0]).toBe("DELETE tweets/1");
		expect(store.xCleanup()).toMatchObject({ deleted: 49, total: 60 });

		const limited = (async () =>
			new Response("too many", { status: 429 })) as unknown as typeof fetch;
		const r2 = await runCleanup(store, now, env, limited);
		expect(r2).toEqual({ deleted: 0, left: 10 });
		expect(store.xCleanup()?.lastError).toContain("429");
	});

	test("Ashi の投稿は消さない", async () => {
		const store = freshStore();
		connect(store);
		store.saveConversations([
			{
				id: "c",
				pending: [],
				lastAt: "",
				messages: [
					{
						id: "keep",
						authorId: "u",
						username: "DoanyBot",
						text: "はじめまして",
						at: "",
						byAshi: true,
					},
				],
			},
		]);
		startCleanup(store, ["keep", "old"], now);
		const hits: string[] = [];
		const f = (async (u: string) => {
			hits.push(u);
			return Response.json({ data: { deleted: true } });
		}) as unknown as typeof fetch;
		await runCleanup(store, now, env, f);
		expect(hits).toEqual(["https://api.x.com/2/tweets/old"]);
		expect(store.xCleanup()?.remaining).toEqual([]);
	});
});
