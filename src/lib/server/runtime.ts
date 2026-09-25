import { resolve } from "node:path";
import { stopAllClaudeCode } from "./ashi/head/claude-code.ts";
import type { Head, Tool } from "./ashi/head/head.ts";
import { makeHead } from "./ashi/head/make.ts";
import {
	fetchBlockage,
	raiseBlocker,
	resolveBlockers,
} from "./ashi/legs/blockers.ts";
import { paperTools } from "./ashi/legs/papers.ts";
import { fetchUrlTool, noteTools } from "./ashi/legs/tools.ts";
import { Walker } from "./ashi/legs/walk.ts";
import { CLEANUP_EVERY_MS, runCleanup } from "./ashi/legs/x-cleanup.ts";
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
	return [
		fetchUrlTool(store.config(), {}, watch),
		...paperTools(store.config()),
		...noteTools(store),
	];
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
	startCleanupTimer();
}

export function isWalking(): boolean {
	return walker?.running === true;
}

/** 休みを切り上げさせる。歩いていないプロセスでは sleepingUntil を消すだけ */
export function wakeNow(): void {
	if (walker) walker.wake();
	else store.saveWalk({ ...store.walk(), sleepingUntil: undefined });
}

/** 学びを白紙に戻す(archive へ移す)。1 歩の途中なら断る。戻したらすぐ歩き出させる */
export function resetLearning():
	| { ok: true; archive: string }
	| { ok: false; message: string } {
	if (walker?.stepping)
		return {
			ok: false,
			message: "いま歩いている途中です。休みに入ってからもう一度押してください",
		};
	const archive = store.resetLearning(new Date());
	wakeNow();
	return { ok: true, archive };
}

export function isStepping(): boolean {
	return walker?.stepping === true;
}

/**
 * X の前の用途の投稿を消す係を 15 分ごとに回す(削除は 15 分に 50 件まで)。
 * 歩いているプロセスだけで回す(状態ファイルを 2 つのプロセスで書き合わない)
 */
function startCleanupTimer(): void {
	const tick = () => {
		runCleanup(store, new Date())
			.then(
				(r) =>
					r &&
					console.log(`[ashi] x-cleanup ${r.deleted} 件消した、残り ${r.left}`),
			)
			.catch((e) => console.warn("[ashi] x-cleanup", e));
	};
	// 起動のたびに間を空けずに回すと上限に当たりやすいので、前回から 15 分空いていれば回す
	const last = store.xCleanup()?.lastRunAt;
	if (!last || Date.now() - new Date(last).getTime() >= CLEANUP_EVERY_MS)
		setTimeout(tick, 10_000).unref();
	setInterval(tick, CLEANUP_EVERY_MS).unref();
}

/** 画面から受け取った直後に 1 回回す(待たずに始める) */
export function kickCleanup(): void {
	if (!walker) return;
	void runCleanup(store, new Date()).catch((e) =>
		console.warn("[ashi] x-cleanup", e),
	);
}
