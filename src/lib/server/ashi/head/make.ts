import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../config.ts";
import { ClaudeHead } from "./claude.ts";
import { ClaudeCodeHead } from "./claude-code.ts";
import type { Head } from "./head.ts";

/**
 * Claude Code の頭に足の道具を渡す MCP サーバーの場所。イメージでは build/mcp.js(束ねたもの)、
 * 手元では src/mcp.ts。どちらも無ければ渡さない(頭は組み込みの WebFetch を使う)。
 * 状態ディレクトリを渡すのは、ノートを探す道具(search_notes)のため
 */
function mcpServer(
	home: string,
): { command: string; args: string[] } | undefined {
	for (const p of ["build/mcp.js", "src/mcp.ts"]) {
		const full = resolve(p);
		if (existsSync(full))
			return {
				command: process.execPath,
				args: [full, `--home=${resolve(home)}`],
			};
	}
	return undefined;
}

/** 設定の head から頭を作る。頭を増やすときはここに足す */
export function makeHead(
	cfg: Pick<Config, "head" | "model" | "effort">,
	home: string,
): Head {
	if (cfg.head === "claude-code") {
		return new ClaudeCodeHead({
			model: cfg.model,
			effort: cfg.effort,
			home,
			mcp: mcpServer(home),
		});
	}
	return new ClaudeHead({ model: cfg.model, effort: cfg.effort });
}
