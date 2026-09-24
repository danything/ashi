import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	ClaudeCodeHead,
	subscriptionBlockage,
} from "../src/lib/server/ashi/head/claude-code.ts";
import {
	HeadAccessError,
	HeadError,
} from "../src/lib/server/ashi/head/head.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
import { localDay } from "../src/lib/server/ashi/state.ts";
import { explore, FakeHead, freshStore } from "./helpers.ts";
import { TMP } from "./setup.ts";

/** 本物の claude の代わり。受け取った引数・標準入力・環境を structured_output に入れて返す */
function fakeClaude(body: string): string {
	const dir = mkdtempSync(join(TMP, "bin-"));
	const bin = join(dir, "claude");
	writeFileSync(bin, `#!/usr/bin/env bun\n${body}\n`);
	chmodSync(bin, 0o755);
	return bin;
}

const ECHO = `
const stdin = await Bun.stdin.text();
const args = process.argv.slice(2);
console.log(JSON.stringify({
	is_error: false,
	usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 },
	structured_output: {
		args,
		stdin,
		cwd: process.cwd(),
		apiKey: process.env.ANTHROPIC_API_KEY ?? null,
		oauth: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? null,
		session: process.env.SESSION_SECRET ?? null,
	},
}));`;

describe("ClaudeCodeHead", () => {
	test("プロンプトは標準入力、道具は notes/ の Read と web だけ、API キーと要らない秘密は渡さない", async () => {
		const home = mkdtempSync(join(TMP, "home-"));
		const head = new ClaudeCodeHead({
			home,
			bin: fakeClaude(ECHO),
			env: {
				PATH: process.env.PATH,
				ANTHROPIC_API_KEY: "sk-ant-api-x",
				CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-y",
				SESSION_SECRET: "s",
			},
		});
		const { output, usage } = await head.think<{
			args: string[];
			stdin: string;
			cwd: string;
			apiKey: null;
			oauth: string;
			session: null;
		}>({
			task: "explore",
			system: "sys",
			history: [{ role: "user", text: "前の話" }],
			prompt: "問いを歩く",
			schema: { type: "object" },
			tools: [
				{
					name: "x",
					description: "",
					inputSchema: {},
					readOnly: true,
					run: async () => "",
				},
			],
			allowWeb: true,
		});
		expect(output.stdin).toContain("持ち主: 前の話");
		expect(output.stdin).toContain("問いを歩く");
		expect(output.cwd).toBe(home);
		expect(output.apiKey).toBeNull();
		expect(output.session).toBeNull();
		expect(output.oauth).toBe("sk-ant-oat-y");
		const a = output.args;
		expect(a[a.indexOf("--tools") + 1]).toBe("Read,WebFetch,WebSearch");
		expect(
			a.slice(a.indexOf("--allowedTools") + 1, a.indexOf("--allowedTools") + 4),
		).toEqual(["Read(./notes/**)", "WebFetch", "WebSearch"]);
		expect(a).toContain("--strict-mcp-config");
		expect(usage).toEqual({ inputTokens: 110, outputTokens: 5, costUsd: 0 });
	});

	test("道具の要らない頼みには道具を渡さない", async () => {
		const head = new ClaudeCodeHead({
			home: TMP,
			bin: fakeClaude(ECHO),
			env: { PATH: process.env.PATH },
		});
		const { output } = await head.think<{ args: string[] }>({
			task: "reflect",
			system: "s",
			prompt: "p",
			schema: {},
		});
		expect(output.args[output.args.indexOf("--tools") + 1]).toBe("");
		expect(output.args).not.toContain("--allowedTools");
	});

	test("サブスクのトークンが通らなければ、付け方つきで弾かれたことにする", async () => {
		const bin = fakeClaude(
			`console.log(JSON.stringify({ is_error: true, api_error_status: 401, result: "Failed to authenticate. API Error: 401 OAuth access token is invalid." })); process.exit(1);`,
		);
		const head = new ClaudeCodeHead({
			home: TMP,
			bin,
			env: { PATH: process.env.PATH },
		});
		const e = await head
			.think({ task: "t", system: "s", prompt: "p", schema: {} })
			.catch((x) => x);
		expect(e).toBeInstanceOf(HeadAccessError);
		expect((e as HeadAccessError).blockage.remedy).toContain(
			"claude setup-token",
		);
	});

	test("JSON でない出力や、形の無い答えはつまずきにする", async () => {
		const head = new ClaudeCodeHead({
			home: TMP,
			bin: fakeClaude(`console.log("oops")`),
			env: { PATH: process.env.PATH },
		});
		expect(
			await head
				.think({ task: "t", system: "s", prompt: "p", schema: {} })
				.catch((x) => x),
		).toBeInstanceOf(HeadError);
		const head2 = new ClaudeCodeHead({
			home: TMP,
			bin: fakeClaude(
				`console.log(JSON.stringify({ is_error: false, result: "text" }))`,
			),
			env: { PATH: process.env.PATH },
		});
		expect(
			(
				(await head2
					.think({ task: "t", system: "s", prompt: "p", schema: {} })
					.catch((x) => x)) as Error
			).message,
		).toContain("形");
	});

	test("CLI が無ければ、そう知らせる", async () => {
		const head = new ClaudeCodeHead({
			home: TMP,
			bin: join(TMP, "no-such-claude"),
			env: {},
		});
		const e = await head
			.think({ task: "t", system: "s", prompt: "p", schema: {} })
			.catch((x) => x);
		expect((e as HeadAccessError).blockage.key).toBe(
			"head:claude-code-missing",
		);
	});
});

describe("subscriptionBlockage", () => {
	test("認証と使用量の上限", () => {
		expect(subscriptionBlockage(401, "")?.key).toBe("head:auth");
		expect(
			subscriptionBlockage(429, "Claude AI usage limit reached")?.key,
		).toBe("head:subscription-limit");
		expect(subscriptionBlockage(500, "overloaded")).toBeUndefined();
	});
});

describe("1 日の歩数の上限", () => {
	const now = new Date("2026-09-25T12:00:00");
	test("上限まで歩いたら翌日まで休み、頭を呼ばない", async () => {
		const store = freshStore(["a"]);
		store.saveBudget({
			day: localDay(now),
			spentUsd: 0,
			inputTokens: 0,
			outputTokens: 0,
			steps: 30,
		});
		const head = new FakeHead({ explore: () => explore() });
		const o = await step({ store, head, tools: [], now: () => now });
		expect(o).toMatchObject({ kind: "broke", reason: "steps" });
		expect(head.calls).toHaveLength(0);
	});

	test("頭を呼んだら 1 歩数える", async () => {
		const store = freshStore(["a"]);
		const head = new FakeHead({ explore: () => explore() });
		await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
		expect(store.budget(localDay(now)).steps).toBe(1);
	});

	test("サブスクの上限に当たったら長く休む", async () => {
		const store = freshStore(["a"]);
		const limited = {
			name: "limited",
			think: async () => {
				throw new HeadAccessError(
					"上限",
					{ inputTokens: 0, outputTokens: 0, costUsd: 0 },
					subscriptionBlockage(429, "usage limit") ?? {
						key: "",
						title: "",
						remedy: "",
					},
				);
			},
		};
		const o = await step({
			store,
			head: limited,
			tools: [],
			now: () => now,
			notify: async () => {},
		});
		expect(o.kind).toBe("failed");
		expect(
			new Date(store.walk().sleepingUntil ?? 0).getTime() - now.getTime(),
		).toBe(360 * 60_000);
	});
});
