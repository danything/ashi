import { describe, expect, test } from "bun:test";
import {
	archiveTool,
	snapshotDate,
} from "../src/lib/server/ashi/legs/archive.ts";

const cfg = { fetch: { maxBytes: 100_000, timeoutMs: 1000 } };
const resolve = async () => ["93.184.216.34"];

function net(routes: Record<string, () => Response>) {
	const hits: string[] = [];
	const fetch = (async (u: URL) => {
		const url = u.toString();
		hits.push(url);
		for (const [prefix, res] of Object.entries(routes))
			if (url.startsWith(prefix)) return res();
		return new Response("nf", { status: 404 });
	}) as unknown as typeof globalThis.fetch;
	return { hits, deps: { fetch, resolve } };
}

const json = (v: unknown) =>
	new Response(JSON.stringify(v), {
		headers: { "content-type": "application/json" },
	});

describe("archived_copy", () => {
	const page = "https://www.jftc.go.jp/freelancelaw_2024/";

	test("いちばん新しい写しを id_ の形で読み、写しが読めたら知らせる", async () => {
		const { hits, deps } = net({
			"https://archive.org/wayback/available": () =>
				json({
					archived_snapshots: {
						closest: {
							available: true,
							status: "200",
							timestamp: "20260908071455",
						},
					},
				}),
			"https://web.archive.org/web/20260908071455id_/": () =>
				new Response("<html><body><h1>フリーランス法</h1></body></html>", {
					headers: { "content-type": "text/html; charset=utf-8" },
				}),
		});
		const copied: string[] = [];
		const out = await archiveTool(cfg, deps, (h) => copied.push(h)).run({
			url: page,
		});
		expect(out).toContain("写し 2026-09-08");
		expect(out).toContain("フリーランス法");
		expect(hits[1]).toBe(
			`https://web.archive.org/web/20260908071455id_/${page}`,
		);
		expect(copied).toEqual(["www.jftc.go.jp"]);
	});

	test("写しが無ければ WARP の検索先を返し、片づけない", async () => {
		const { deps } = net({
			"https://archive.org/wayback/available": () =>
				json({ archived_snapshots: {} }),
		});
		const copied: string[] = [];
		const out = await archiveTool(cfg, deps, (h) => copied.push(h)).run({
			url: page,
		});
		expect(out).toContain("warp.ndl.go.jp");
		expect(copied).toEqual([]);
	});

	test("available API が空なら CDX で引き直す", async () => {
		const { hits, deps } = net({
			"https://archive.org/wayback/available": () =>
				json({ archived_snapshots: {} }),
			"https://web.archive.org/cdx/": () =>
				json([["timestamp"], ["20260825010722"], ["20260921114442"]]),
			"https://web.archive.org/web/20260921114442id_/": () =>
				new Response("中小企業庁", {
					headers: { "content-type": "text/plain" },
				}),
		});
		const out = await archiveTool(cfg, deps).run({
			url: "https://www.chusho.meti.go.jp/",
		});
		expect(out).toContain("写し 2026-09-21");
		expect(out).toContain("中小企業庁");
		expect(hits).toHaveLength(3);
	});

	test("URL でないものは読まない", async () => {
		const { hits, deps } = net({});
		expect(
			await archiveTool(cfg, deps).run({ url: "file:///etc/passwd" }),
		).toBe("http と https だけ");
		expect(hits).toEqual([]);
	});

	test("日付の形", () => {
		expect(snapshotDate("20260908071455")).toBe("2026-09-08");
	});
});
