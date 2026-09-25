import { describe, expect, test } from "bun:test";
import {
	invertedToText,
	paperTools,
} from "../src/lib/server/ashi/legs/papers.ts";
import { handle } from "../src/mcp.ts";

const cfg = { fetch: { maxBytes: 100_000, timeoutMs: 1000 } };
const resolve = async () => ["93.184.216.34"];

/** URL ごとに決めた答えを返す偽の fetch */
function net(routes: Record<string, () => Response>) {
	const hits: string[] = [];
	const fetch = (async (u: URL) => {
		const url = u.toString();
		hits.push(url);
		for (const [prefix, res] of Object.entries(routes))
			if (url.startsWith(prefix)) return res();
		return new Response("nf", {
			status: 404,
			headers: { "content-type": "text/plain" },
		});
	}) as unknown as typeof globalThis.fetch;
	return { hits, deps: { fetch, resolve } };
}

describe("invertedToText", () => {
	test("OpenAlex の要旨を文に戻す", () => {
		expect(invertedToText({ sleep: [1], Unihemispheric: [0], is: [2] })).toBe(
			"Unihemispheric sleep is",
		);
		expect(invertedToText(null)).toBe("");
	});
});

describe("find_papers", () => {
	test("Europe PMC と OpenAlex を合わせ、同じ論文には公開版の先だけ足す", async () => {
		const { deps, hits } = net({
			"https://www.ebi.ac.uk/europepmc/webservices/rest/search": () =>
				Response.json({
					resultList: {
						result: [
							{
								title: "Eye state asymmetry",
								pubYear: "2019",
								doi: "10.1371/journal.pone.0217025",
								pmcid: "PMC6546242",
								isOpenAccess: "Y",
								abstractText: "<p>USWS is unique</p>",
							},
						],
					},
				}),
			"https://api.openalex.org/works": () =>
				Response.json({
					results: [
						{
							title: "Eye state asymmetry",
							doi: "https://doi.org/10.1371/journal.pone.0217025",
							open_access: {
								is_oa: true,
								oa_url: "https://journals.plos.org/x.pdf",
							},
						},
						{
							title: "Paywalled one",
							publication_year: 2018,
							doi: "https://doi.org/10.1016/j.cub.2018.01.001",
							open_access: { is_oa: false },
						},
					],
				}),
		});
		const [find] = paperTools(cfg, deps);
		const out = await find?.run({ query: "unihemispheric sleep fur seal" });
		expect(out).toContain('read_paper に pmcid "PMC6546242"');
		expect(out).toContain("USWS is unique");
		expect(out).toContain(
			"↳ Eye state asymmetry の公開版: https://journals.plos.org/x.pdf",
		);
		expect(out).toContain("Paywalled one");
		expect(hits.some((h) => h.includes("europepmc"))).toBe(true);
	});

	test("DOI なら DOI で引く", async () => {
		const { deps, hits } = net({});
		const [find] = paperTools(cfg, deps);
		await find?.run({ query: "https://doi.org/10.1016/J.CUB.2018.01.001" });
		expect(hits.find((h) => h.includes("openalex"))).toBe(
			"https://api.openalex.org/works/doi:10.1016%2Fj.cub.2018.01.001",
		);
		expect(
			decodeURIComponent(hits.find((h) => h.includes("europepmc")) ?? ""),
		).toContain('DOI:"10.1016/j.cub.2018.01.001"');
	});
});

describe("read_paper", () => {
	test("PMCID なら Europe PMC の本文を読む", async () => {
		const { deps } = net({
			"https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6546242/fullTextXML":
				() =>
					new Response(
						"<article><body><p>Fur seals sleep with one hemisphere.</p></body></article>",
						{
							headers: { "content-type": "application/xml" },
						},
					),
		});
		const [, read] = paperTools(cfg, deps);
		expect(await read?.run({ pmcid: "pmc6546242", url: "" })).toContain(
			"Fur seals sleep with one hemisphere.",
		);
	});

	test("読めなければ、ほかの公開版を探すよう返す", async () => {
		const { deps } = net({});
		const [, read] = paperTools(cfg, deps);
		expect(
			await read?.run({ pmcid: "", url: "https://www.cell.com/x" }),
		).toContain("404");
		expect(await read?.run({ pmcid: "", url: "" })).toContain("どちらか");
	});
});

describe("MCP サーバー", () => {
	test("道具の一覧を返し、知らない道具は断る。通知には返事をしない", async () => {
		const list = await handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
		const tools =
			(list?.result as { tools: { name: string }[] } | undefined)?.tools ?? [];
		const names = tools.map((t) => t.name);
		expect(names).toEqual(["fetch_url", "find_papers", "read_paper"]);
		const init = await handle({
			jsonrpc: "2.0",
			id: 2,
			method: "initialize",
			params: { protocolVersion: "2025-06-18" },
		});
		expect(init?.result).toMatchObject({
			protocolVersion: "2025-06-18",
			capabilities: { tools: {} },
		});
		expect(
			await handle({ jsonrpc: "2.0", method: "notifications/initialized" }),
		).toBeUndefined();
		const bad = await handle({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "write_file" },
		});
		expect(bad?.error).toBeDefined();
		// 手元のネットワークは MCP の fetch_url でも読まない
		const priv = await handle({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "fetch_url", arguments: { url: "http://127.0.0.1/" } },
		});
		expect(priv?.result).toMatchObject({ isError: true });
	});
});
