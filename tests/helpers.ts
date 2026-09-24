import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import {
	type Head,
	HeadError,
	type ThinkRequest,
	type ThinkResult,
} from "../src/lib/server/ashi/head/head.ts";
import { type Question, Store } from "../src/lib/server/ashi/state.ts";
import { TMP } from "./setup.ts";

/** まっさらな状態ディレクトリ */
export function freshStore(seed: string[] = []): Store {
	const store = new Store(mkdtempSync(join(TMP, "home-")));
	store.init(seed);
	return store;
}

type Reply = (req: ThinkRequest) => unknown;

/** 仕事(task)ごとに決めた答えを返す頭。受け取った頼みを全部取っておく */
export class FakeHead implements Head {
	readonly name = "fake";
	calls: ThinkRequest[] = [];
	costUsd = 0.01;
	constructor(private replies: Partial<Record<string, Reply>>) {}

	async think<T>(req: ThinkRequest): Promise<ThinkResult<T>> {
		this.calls.push(req);
		const usage = { inputTokens: 100, outputTokens: 50, costUsd: this.costUsd };
		const reply = this.replies[req.task];
		if (!reply)
			throw new HeadError(`${req.task} の答えを用意していない`, usage);
		return { output: reply(req) as T, usage };
	}
}

export const q = (over: Partial<Question> = {}): Question => ({
	id: Math.random().toString(16).slice(2, 10),
	text: "問い",
	theme: "t",
	track: "self",
	interest: 0.5,
	importance: 0.5,
	feasibility: 0.5,
	status: "open",
	visits: 0,
	createdAt: "2026-09-24T00:00:00.000Z",
	...over,
});

export const explore = (over: Record<string, unknown> = {}) => ({
	title: "ノートの題",
	summary: "要約",
	findings: "本文",
	answered: false,
	new_questions: [],
	tiredness: 0.2,
	sleep_minutes: 30,
	...over,
});
