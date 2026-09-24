import { resolve } from "node:path";
import { ClaudeHead } from "./ashi/head/claude.ts";
import type { Head, Tool } from "./ashi/head/head.ts";
import { fetchUrlTool, noteTools } from "./ashi/legs/tools.ts";
import { Walker } from "./ashi/legs/walk.ts";
import { Store } from "./ashi/state.ts";

/**
 * 画面のサーバーと歩みを 1 つのプロセスにまとめる(状態ファイルを 2 つのプロセスで書き合わないため)。
 * ASHI_WALK=0 なら歩かせず、画面だけ出す。
 */

export const store = new Store(resolve(process.env.ASHI_HOME || "data"));
if (!store.exists()) store.init();

let head: Head | undefined;
/** 頭。モデルと effort は ashi.json から(変えたら再起動) */
export function getHead(): Head {
	if (!head) {
		const cfg = store.config();
		head = new ClaudeHead({ model: cfg.model, effort: cfg.effort });
	}
	return head;
}

export function getTools(): Tool[] {
	return [fetchUrlTool(store.config()), ...noteTools(store)];
}

let walker: Walker | undefined;

export function startWalking(): void {
	if (walker || process.env.ASHI_WALK === "0") return;
	const lock = store.lockWalking();
	if ("heldBy" in lock) {
		console.warn(
			`[ashi] pid ${lock.heldBy} が歩いているので、このプロセスは画面だけ出す`,
		);
		return;
	}
	process.on("exit", lock.release);
	walker = new Walker({ store, head: getHead(), tools: getTools() }, (o) => {
		console.log(
			`[ashi] ${o.kind}${"wakeAt" in o ? ` → ${o.wakeAt.toISOString()}` : ""}`,
		);
	});
	void walker.run();
}

export function isWalking(): boolean {
	return walker?.running === true;
}

/** 休みを切り上げさせる。歩いていないプロセスでは sleepingUntil を消すだけ */
export function wakeNow(): void {
	if (walker) walker.wake();
	else store.saveWalk({ ...store.walk(), sleepingUntil: undefined });
}
