import { describe, expect, test } from "bun:test";
import {
	crawlRequested,
	describeGithubEvent,
	feedStatus,
	parseFeed,
} from "../src/lib/server/ashi/legs/feeds.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
import { explore, FakeHead, freshStore } from "./helpers.ts";

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>k3s を Talos に移す</title><link>https://doany.io/posts/talos/</link><guid>https://doany.io/posts/talos/</guid>
<description><![CDATA[<p>USB を焼いた &amp; ドリルを 6 回</p>]]></description><pubDate>Sat, 12 Sep 2026 00:00:00 GMT</pubDate></item>
<item><title>Forgejo に移した</title><link>https://doany.io/posts/forgejo/</link><description>Actions の課金が止まった</description></item>
</channel></rss>`;

const ATOM = `<feed><entry><title>Atom の記事</title><link href="https://example.com/a"/><id>tag:a</id><summary>要約</summary></entry></feed>`;

describe("parseFeed", () => {
	test("RSS と Atom の記事を読む", () => {
		const items = parseFeed(RSS);
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({
			key: "https://doany.io/posts/talos/",
			title: "k3s を Talos に移す",
		});
		expect(items[0]?.body).toBe("USB を焼いた & ドリルを 6 回");
		expect(items[1]?.key).toBe("https://doany.io/posts/forgejo/");
		expect(parseFeed(ATOM)[0]).toMatchObject({
			key: "tag:a",
			url: "https://example.com/a",
			body: "要約",
		});
	});
});

describe("describeGithubEvent", () => {
	const base = { id: "1", created_at: "", repo: { name: "5ym/x" } };
	test("push・スター・PR を文にし、興味の薄いものは落とす", () => {
		expect(
			describeGithubEvent({
				...base,
				type: "PushEvent",
				payload: { commits: [{ message: "直した\n\n詳細" }] },
			}),
		).toBe("5ym/x に push: 直した");
		expect(
			describeGithubEvent({ ...base, type: "WatchEvent", payload: {} }),
		).toBe("5ym/x にスターを付けた");
		expect(
			describeGithubEvent({ ...base, type: "DeleteEvent", payload: {} }),
		).toBeUndefined();
	});
});

const net = (routes: Record<string, () => Response>) => {
	const hits: string[] = [];
	const fetch = (async (u: URL) => {
		hits.push(u.toString());
		const r = routes[u.toString()];
		return r
			? r()
			: new Response("nf", {
					status: 404,
					headers: { "content-type": "text/plain" },
				});
	}) as unknown as typeof globalThis.fetch;
	return { hits, deps: { fetch, resolve: async () => ["93.184.216.34"] } };
};

const withFeeds = () => {
	const store = freshStore(["a"]);
	store.writeText(
		"ashi.json",
		JSON.stringify({
			feeds: [
				{ id: "blog", kind: "rss", target: "https://doany.io/rss.xml" },
				{ id: "gh", kind: "github", target: "5ym" },
				{ id: "x", kind: "x", target: "someone" },
			],
		}),
	);
	return store;
};

describe("crawlRequested", () => {
	const now = new Date("2026-09-24T12:00:00Z");

	test("頼まれた足跡を読み、新しいものだけ材料にする", async () => {
		const store = withFeeds();
		const { deps } = net({
			"https://doany.io/rss.xml": () =>
				new Response(RSS, {
					headers: { "content-type": "application/rss+xml" },
				}),
			"https://api.github.com/users/5ym/events/public?per_page=100": () =>
				Response.json([
					{
						id: "9",
						type: "WatchEvent",
						created_at: "",
						repo: { name: "cilium/cilium" },
						payload: {},
					},
				]),
		});
		const r = await crawlRequested(
			store,
			["blog", "gh", "unknown"],
			now,
			deps,
			{},
		);
		expect(r).toEqual([
			{ id: "blog", added: 2 },
			{ id: "gh", added: 1 },
		]);
		expect(store.sources().map((s) => s.title)).toEqual([
			"k3s を Talos に移す",
			"Forgejo に移した",
			"GitHub の動き(1 件)",
		]);
		expect(store.sourceBody(store.sources()[2]?.id ?? "")).toContain(
			"cilium/cilium にスター",
		);

		// 間隔の下限に届かないうちは読まない
		expect(
			await crawlRequested(
				store,
				["blog"],
				new Date(now.getTime() + 3600_000),
				deps,
				{},
			),
		).toEqual([]);
		// 空けたら読むが、同じ記事は取り込まない
		const later = await crawlRequested(
			store,
			["blog"],
			new Date(now.getTime() + 7 * 3600_000),
			deps,
			{},
		);
		expect(later).toEqual([{ id: "blog", added: 0 }]);
		expect(store.sources()).toHaveLength(3);
	});

	test("X は鍵が無ければ失敗として残し、間隔は空ける", async () => {
		const store = withFeeds();
		const { deps, hits } = net({});
		const r = await crawlRequested(store, ["x"], now, deps, {});
		expect(r[0]?.error).toContain("X_BEARER_TOKEN");
		expect(hits).toHaveLength(0);
		expect(store.feedStates().x?.lastError).toContain("X_BEARER_TOKEN");
		expect(feedStatus(store, now)).toContain("失敗");
	});
});

describe("step と crawl", () => {
	test("頭が頼んだ足跡を次の歩みの前に読み、材料が増えたので地図を書き直す", async () => {
		const store = withFeeds();
		const now = new Date("2026-09-24T12:00:00");
		const { deps, hits } = net({
			"https://doany.io/rss.xml": () =>
				new Response(RSS, { headers: { "content-type": "text/xml" } }),
		});
		const head = new FakeHead({
			explore: (req) => {
				expect(req.prompt).toContain("blog [rss]");
				return explore({ crawl: ["blog", 42] });
			},
			profile: () => ({
				owner: "# 地図\n\nTalos への移行を考えている人。",
				new_questions: [],
			}),
		});
		await step({
			store,
			head,
			tools: [],
			now: () => now,
			rng: () => 0.99,
			net: deps,
			env: {},
		});
		expect(store.walk().crawlRequests).toEqual(["blog"]);
		expect(hits).toHaveLength(0);

		store.saveWalk({ ...store.walk(), sleepingUntil: undefined });
		await step({
			store,
			head,
			tools: [],
			now: () => now,
			rng: () => 0.99,
			net: deps,
			env: {},
		});
		expect(hits).toEqual(["https://doany.io/rss.xml"]);
		expect(head.calls.map((c) => c.task)).toEqual([
			"explore",
			"profile",
			"explore",
		]);
		expect(store.owner()).toContain("Talos");
	});
});
