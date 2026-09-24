import { resolve } from "node:path";
import { stopAllClaudeCode } from "./ashi/head/claude-code.ts";
import type { Head, Tool } from "./ashi/head/head.ts";
import { makeHead } from "./ashi/head/make.ts";
import {
	fetchBlockage,
	raiseBlocker,
	resolveBlockers,
} from "./ashi/legs/blockers.ts";
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
/** 頭。繋ぎ方・モデル・effort は設定から(変えたら再起動) */
export function getHead(): Head {
	if (!head) {
		const cfg = store.config();
		head = makeHead(cfg, store.home);
	}
	return head;
}

export function getTools(): Tool[] {
	// 頭の fetch_url が弾かれたら持ち主に知らせ、同じ先が通ったら片づける
	const watch = {
		blocked(host: string, status: number | "private") {
			const b = fetchBlockage(host, status);
			if (b) void raiseBlocker(store, "fetch", b, new Date());
		},
		ok(host: string) {
			resolveBlockers(store, `fetch:${host}`, new Date());
		},
	};
	return [fetchUrlTool(store.config(), {}, watch), ...noteTools(store)];
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
	const ac = new AbortController();
	// adapter-node は SIGTERM で受付を閉じ、処理中の要求を待ってから sveltekit:shutdown を出す。
	// 歩みの休み(タイマー)と頭の CLI が残っているとプロセスが終わらず、Pod が
	// terminationGracePeriodSeconds(30 秒)いっぱい待って殺される。そのぶんデプロイで画面が落ちていた。
	// 歩みの途中で止めても、状態ファイルは差し替えで書くので壊れない(その 1 歩が無かったことになるだけ)
	process.once("sveltekit:shutdown", () => {
		ac.abort();
		stopAllClaudeCode();
		lock.release();
		process.exit(0);
	});
	walker = new Walker({ store, head: getHead(), tools: getTools() }, (o) => {
		console.log(
			`[ashi] ${o.kind}${"wakeAt" in o ? ` → ${o.wakeAt.toISOString()}` : ""}`,
		);
	});
	void walker.run(ac.signal);
}

export function isWalking(): boolean {
	return walker?.running === true;
}

/** 休みを切り上げさせる。歩いていないプロセスでは sleepingUntil を消すだけ */
export function wakeNow(): void {
	if (walker) walker.wake();
	else store.saveWalk({ ...store.walk(), sleepingUntil: undefined });
}
