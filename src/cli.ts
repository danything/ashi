#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { makeHead } from "./lib/server/ashi/head/make.ts";
import { archiveTool } from "./lib/server/ashi/legs/archive.ts";
import { paperTools } from "./lib/server/ashi/legs/papers.ts";
import { fetchUrlTool, noteTools } from "./lib/server/ashi/legs/tools.ts";
import {
	type Legs,
	type StepOutcome,
	step,
	Walker,
} from "./lib/server/ashi/legs/walk.ts";
import { hashText, localDay, Store } from "./lib/server/ashi/state.ts";

/**
 * 手元で動かすための入口。画面付きで常駐させるときはサーバー(build/index.js)が歩くので、これは使わない。
 *
 *   ashi init [問い...]   状態ディレクトリを作る(問いを渡すと最初の行き先になる)
 *   ashi step             1 歩だけ歩く(休み中でも起こす)
 *   ashi walk             止めるまで歩く(Ctrl+C)
 *   ashi status           いまの様子
 *   ashi reset            学びを白紙に戻す(archive/ へ移す。歩いているプロセスがあれば画面から)
 *   ashi core --accept    core.md の書き換えを認める(人だけが実行する)
 *
 * 状態ディレクトリは --home か ASHI_HOME、無ければ ./data
 */

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		home: { type: "string" },
		accept: { type: "boolean" },
	},
});
const [cmd, ...rest] = positionals;
const store = new Store(
	resolve(values.home ?? (process.env.ASHI_HOME || "data")),
);

function legs(): Legs {
	const cfg = store.config();
	return {
		store,
		head: makeHead(cfg, store.home),
		tools: [
			fetchUrlTool(cfg),
			...paperTools(cfg),
			archiveTool(cfg),
			...noteTools(store),
		],
	};
}

function describe(o: StepOutcome): string {
	switch (o.kind) {
		case "walked":
			return `歩いた(${o.reason === "detour" ? "寄り道" : o.reason === "echo" ? "言い換えの繰り返し" : o.reason === "verify" ? "言ったことの確かめ" : o.reason === "promised" ? "次の一歩の約束" : "点数順"})ノート ${o.noteId}${o.profiled ? "・地図を書き直した" : ""}${o.reflected ? "・内省した" : ""} → ${o.wakeAt.toLocaleString()} まで休む`;
		case "seeded":
			return `${o.track === "owner" ? "先回り" : "個性"}の問いを ${o.added} 個探した${o.reflected ? "・内省した" : ""} → ${o.wakeAt.toLocaleString()} まで休む`;
		case "asleep":
			return `休んでいる(${o.wakeAt.toLocaleString()} まで)`;
		case "broke":
			return `${o.reason === "steps" ? "今日の歩数の上限に来た" : "今日の予算を使い切った"} → ${o.wakeAt.toLocaleString()} まで休む`;
		case "failed":
			return `つまずいた: ${o.error}`;
		case "core-changed":
			return "core.md が承認なしに変わっている。確かめて `ashi core --accept` するまで歩かない";
	}
}

function requireInit() {
	if (!store.exists()) {
		console.error(`${store.home} はまだ無い。先に ashi init`);
		process.exit(1);
	}
}

switch (cmd) {
	case "init": {
		store.init(rest);
		console.log(
			`${store.home} を作った。core.md と ashi.json を読んでから歩かせる`,
		);
		break;
	}
	case "step": {
		requireInit();
		const lock = store.lockWalking();
		if ("heldBy" in lock) {
			console.error(`pid ${lock.heldBy} が歩いている`);
			process.exit(1);
		}
		try {
			store.saveWalk({ ...store.walk(), sleepingUntil: undefined });
			console.log(describe(await step(legs())));
		} finally {
			lock.release();
		}
		break;
	}
	case "walk": {
		requireInit();
		const lock = store.lockWalking();
		if ("heldBy" in lock) {
			console.error(`pid ${lock.heldBy} が歩いている`);
			process.exit(1);
		}
		const ac = new AbortController();
		process.on("SIGINT", () => {
			console.log("止める");
			ac.abort();
		});
		try {
			await new Walker(legs(), (o) =>
				console.log(`${new Date().toLocaleString()} ${describe(o)}`),
			).run(ac.signal);
		} finally {
			lock.release();
		}
		break;
	}
	case "status": {
		requireInit();
		const w = store.walk();
		const b = store.budget(localDay(new Date()));
		const cfg = store.config();
		const qs = store.questions();
		console.log(
			`歩数 ${w.steps} / ノート ${store.notes().length} / 開いている問い ${qs.filter((q) => q.status === "open").length}`,
		);
		console.log(`今日 $${b.spentUsd.toFixed(3)} / $${cfg.budget.dailyUsd}`);
		console.log(
			w.sleepingUntil
				? `${new Date(w.sleepingUntil).toLocaleString()} まで休む`
				: "起きている",
		);
		if (hashText(store.core()) !== w.coreHash)
			console.log("core.md が承認なしに変わっている(ashi core --accept)");
		break;
	}
	case "reset": {
		requireInit();
		const lock = store.lockWalking();
		if ("heldBy" in lock) {
			console.error(
				`pid ${lock.heldBy} が歩いている。画面の「頭の中」からリセットする`,
			);
			process.exit(1);
		}
		try {
			console.log(
				`学びを白紙に戻した。前の学びは ${store.resetLearning(new Date())} にある`,
			);
		} finally {
			lock.release();
		}
		break;
	}
	case "core": {
		requireInit();
		if (!values.accept) {
			console.log(store.core());
			break;
		}
		store.saveWalk({ ...store.walk(), coreHash: hashText(store.core()) });
		store.log("core-accepted");
		console.log("core.md の今の中身を認めた");
		break;
	}
	default:
		console.log("ashi init | step | walk | status | reset | core [--accept]");
}
