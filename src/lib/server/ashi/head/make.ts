import type { Config } from "../config.ts";
import { ClaudeHead } from "./claude.ts";
import { ClaudeCodeHead } from "./claude-code.ts";
import type { Head } from "./head.ts";

/** 設定の head から頭を作る。頭を増やすときはここに足す */
export function makeHead(
	cfg: Pick<Config, "head" | "model" | "effort">,
	home: string,
): Head {
	if (cfg.head === "claude-code") {
		return new ClaudeCodeHead({ model: cfg.model, effort: cfg.effort, home });
	}
	return new ClaudeHead({ model: cfg.model, effort: cfg.effort });
}
