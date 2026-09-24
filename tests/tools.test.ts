import { describe, expect, test } from "bun:test";
import {
	assertPublicUrl,
	fetchUrlTool,
	htmlToText,
	isPrivateAddress,
	noteTools,
} from "../src/lib/server/ashi/legs/tools.ts";
import { freshStore } from "./helpers.ts";

describe("isPrivateAddress", () => {
	test.each([
		["127.0.0.1", true],
		["10.43.0.1", true],
		["192.168.1.1", true],
		["172.20.0.1", true],
		["169.254.169.254", true],
		["100.64.0.1", true],
		["::1", true],
		["fd00::1", true],
		["fe80::1", true],
		["::ffff:127.0.0.1", true],
		["8.8.8.8", false],
		["2001:4860:4860::8888", false],
	])("%s → %p", (ip, want) => {
		expect(isPrivateAddress(ip)).toBe(want);
	});
});

describe("assertPublicUrl", () => {
	const resolve = async (host: string) =>
		host === "inside.example" ? ["10.0.0.5"] : ["93.184.216.34"];
	test("http(s) の公開先だけ通す", async () => {
		expect(
			(await assertPublicUrl("https://example.com/a", resolve)).hostname,
		).toBe("example.com");
		await expect(
			assertPublicUrl("file:///etc/passwd", resolve),
		).rejects.toThrow();
		await expect(
			assertPublicUrl("http://inside.example/", resolve),
		).rejects.toThrow("手元");
		await expect(
			assertPublicUrl("http://127.0.0.1:3000/", resolve),
		).rejects.toThrow("手元");
		await expect(assertPublicUrl("http://[::1]/", resolve)).rejects.toThrow(
			"手元",
		);
		await expect(
			assertPublicUrl("https://u:p@example.com/", resolve),
		).rejects.toThrow("認証");
	});
});

describe("fetch_url", () => {
	const resolve = async (host: string) =>
		host === "inside.example" ? ["10.0.0.5"] : ["93.184.216.34"];
	const cfg = { fetch: { maxBytes: 1000, timeoutMs: 1000 } };

	test("GET だけで読み、HTML を文字にする", async () => {
		const seen: RequestInit[] = [];
		const fake = (async (_u: URL, init: RequestInit) => {
			seen.push(init);
			return new Response(
				"<html><script>x()</script><p>こんにちは &amp; さようなら</p></html>",
				{
					headers: { "content-type": "text/html" },
				},
			);
		}) as unknown as typeof fetch;
		const out = await fetchUrlTool(cfg, { fetch: fake, resolve }).run({
			url: "https://example.com/",
		});
		expect(out).toContain("こんにちは & さようなら");
		expect(out).not.toContain("x()");
		expect(seen[0]?.method).toBe("GET");
	});

	test("手元への転送は追わない", async () => {
		const fake = (async () =>
			new Response(null, {
				status: 302,
				headers: { location: "http://inside.example/admin" },
			})) as unknown as typeof fetch;
		await expect(
			fetchUrlTool(cfg, { fetch: fake, resolve }).run({
				url: "https://example.com/",
			}),
		).rejects.toThrow("手元");
	});
});

describe("htmlToText", () => {
	test("style と script を落とす", () => {
		expect(htmlToText("<style>a{}</style><div>本文</div>")).toBe("本文");
	});
});

describe("noteTools", () => {
	test("ノートを探して読む。id の形が違えば読まない", async () => {
		const store = freshStore();
		store.addNote(
			{
				id: "abcdef12",
				title: "星の名前",
				theme: "天文",
				questionId: "q",
				summary: "ベテルギウス",
				createdAt: "",
			},
			"# 星の名前\n\nアラビア語由来が多い",
		);
		const [search, read] = noteTools(store);
		expect(await search?.run({ query: "アラビア" })).toContain("abcdef12");
		expect(await read?.run({ id: "abcdef12" })).toContain("アラビア語");
		expect(await read?.run({ id: "../walk" })).toContain("無い");
	});
});
