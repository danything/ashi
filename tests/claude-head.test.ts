import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeHead } from "../src/lib/server/ashi/head/claude.ts";

/** 決まった usage の答えを 1 回返す偽のクライアント */
function fakeClient(model: string, usage: Partial<Anthropic.Beta.BetaUsage>) {
	return {
		beta: {
			messages: {
				stream: () => ({
					finalMessage: async () => ({
						model,
						stop_reason: "end_turn",
						content: [{ type: "text", text: '{"ok":true}' }],
						usage: {
							input_tokens: 0,
							output_tokens: 0,
							cache_read_input_tokens: 0,
							cache_creation_input_tokens: 0,
							...usage,
						},
					}),
				}),
			},
		},
	} as unknown as Anthropic;
}

const think = (head: ClaudeHead) =>
	head.think<{ ok: boolean }>({
		task: "t",
		system: "s",
		prompt: "p",
		schema: { type: "object" },
	});

describe("ClaudeHead の料金", () => {
	test("Haiku 5.5 はプロンプトが 10 万トークン以下なら入力 0.1・出力 0.5 ドル", async () => {
		const head = new ClaudeHead({
			model: "claude-haiku-5-5",
			client: fakeClient("claude-haiku-5-5", {
				input_tokens: 100_000,
				output_tokens: 1_000_000,
			}),
		});
		const { usage } = await think(head);
		expect(usage.costUsd).toBeCloseTo(0.01 + 0.5, 6);
	});

	test("Haiku 5.5 はプロンプトが 10 万トークンを超えたら入力 0.5・出力 2.5 ドル(キャッシュの読みは 0.1 倍)", async () => {
		const head = new ClaudeHead({
			model: "claude-haiku-5-5",
			client: fakeClient("claude-haiku-5-5", {
				input_tokens: 1_000,
				cache_read_input_tokens: 1_000_000,
				output_tokens: 1_000_000,
			}),
		});
		const { usage } = await think(head);
		expect(usage.costUsd).toBeCloseTo(0.0005 + 0.05 + 2.5, 6);
	});
});
