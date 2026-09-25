#!/usr/bin/env bun
import { DEFAULT_CONFIG } from "./lib/server/ashi/config.ts";
import type { Tool } from "./lib/server/ashi/head/head.ts";
import { archiveTool } from "./lib/server/ashi/legs/archive.ts";
import { paperTools } from "./lib/server/ashi/legs/papers.ts";
import { fetchUrlTool } from "./lib/server/ashi/legs/tools.ts";

/**
 * Claude Code の頭に Ashi の道具を渡す MCP サーバー(stdio)。CLI が `--mcp-config` で起動する。
 *
 * 頭が Claude Code だと、足の道具(fetch_url など)を直には渡せない。組み込みの WebFetch だと
 * プライベートアドレスを読まないガードも効かない。ここで足の道具をそのまま出す。
 * 渡すのは読むだけの道具だけ。秘密は要らないので、CLI が落とした環境のまま動く。
 *
 * MCP の stdio は 1 行 1 JSON-RPC。使うのは initialize・tools/list・tools/call・ping だけなので、
 * SDK は入れずにここで書く。
 */

const cfg = DEFAULT_CONFIG;
const TOOLS: Tool[] = [fetchUrlTool(cfg), ...paperTools(cfg), archiveTool(cfg)];
const byName = new Map(TOOLS.map((t) => [t.name, t]));

interface Rpc {
	jsonrpc: "2.0";
	id?: number | string | null;
	method?: string;
	params?: Record<string, unknown>;
}

function send(msg: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
}

export async function handle(
	req: Rpc,
): Promise<Record<string, unknown> | undefined> {
	// id の無いものは通知(返事をしない)
	if (req.id === undefined || req.id === null) return undefined;
	switch (req.method) {
		case "initialize":
			return {
				id: req.id,
				result: {
					protocolVersion: String(req.params?.protocolVersion ?? "2025-06-18"),
					capabilities: { tools: {} },
					serverInfo: { name: "ashi", version: "1" },
				},
			};
		case "ping":
			return { id: req.id, result: {} };
		case "tools/list":
			return {
				id: req.id,
				result: {
					tools: TOOLS.map((t) => ({
						name: t.name,
						description: t.description,
						inputSchema: t.inputSchema,
					})),
				},
			};
		case "tools/call": {
			const tool = byName.get(String(req.params?.name ?? ""));
			if (!tool)
				return {
					id: req.id,
					error: {
						code: -32602,
						message: `${req.params?.name} という道具は無い`,
					},
				};
			try {
				const text = await tool.run(req.params?.arguments ?? {});
				return { id: req.id, result: { content: [{ type: "text", text }] } };
			} catch (e) {
				return {
					id: req.id,
					result: {
						content: [
							{
								type: "text",
								text: e instanceof Error ? e.message : String(e),
							},
						],
						isError: true,
					},
				};
			}
		}
		default:
			return {
				id: req.id,
				error: { code: -32601, message: `${req.method} は無い` },
			};
	}
}

if (import.meta.main) {
	let buf = "";
	const pending = new Set<Promise<unknown>>();
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (chunk: string) => {
		buf += chunk;
		let i = buf.indexOf("\n");
		while (i >= 0) {
			const line = buf.slice(0, i).trim();
			buf = buf.slice(i + 1);
			i = buf.indexOf("\n");
			if (!line) continue;
			let req: Rpc;
			try {
				req = JSON.parse(line) as Rpc;
			} catch {
				send({
					id: null,
					error: { code: -32700, message: "JSON として読めない" },
				});
				continue;
			}
			// 道具は並べて呼ばれることがあるので、待たずに次の行を読む
			const p = handle(req).then((res) => res && send(res));
			pending.add(p);
			void p.finally(() => pending.delete(p));
		}
	});
	// 入力が閉じても、処理中の道具の返事を書き終えてから抜ける
	process.stdin.on("end", async () => {
		await Promise.allSettled([...pending]);
		process.exit(0);
	});
}
