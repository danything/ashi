import { describe, expect, test } from "bun:test";
import { chat } from "../src/lib/server/ashi/legs/chat.ts";
import {
	citationConflicts,
	unsettledConflicts,
} from "../src/lib/server/ashi/legs/citations.ts";
import { closeByNote, debtLedger } from "../src/lib/server/ashi/legs/guard.ts";
import { talkWithStranger } from "../src/lib/server/ashi/legs/stranger.ts";
import { sweepingSentences } from "../src/lib/server/ashi/legs/style.ts";
import { FakeHead, freshStore, q } from "./helpers.ts";

const now = new Date("2026-10-10T03:00:00Z");

describe("著者の食い違い", () => {
	test("誌名の一般語(Research など)は著者として数えない", () => {
		expect(
			citationConflicts([
				{ id: "n1", text: "Journal of Consumer Research 2026、査読前" },
				{ id: "n2", text: "Journal of Consumer Research 2026 に採録" },
			]),
		).toEqual([]);
	});

	test("足が積んだ確かめの問いが閉じた食い違いは、もう見せない", () => {
		const c = {
			authors: "Novak",
			kind: "status" as const,
			variants: [
				{ label: "査読前", noteIds: ["n1"] },
				{ label: "採録・出版", noteIds: ["n2"] },
			],
		};
		const check = (status: "open" | "answered") => ({
			text: "Novak の論文の査読の状態が、ノートで食い違っている(…)。どれが正しいか",
			status,
			via: "citations",
		});
		expect(unsettledConflicts([c], [check("open")])).toHaveLength(1);
		expect(unsettledConflicts([c], [check("answered")])).toEqual([]);
		expect(unsettledConflicts([c], [])).toHaveLength(1);
	});
});

test("答えの出たノートで、開いた問いを閉じる。無いノート・閉じた問いには当てない", () => {
	const qs = [
		q({ id: "aaaaaaa1" }),
		q({ id: "aaaaaaa2", status: "answered" }),
		q({ id: "aaaaaaa3" }),
	];
	const r = closeByNote(
		qs,
		[
			{ question_id: "aaaaaaa1", note_id: "bbbbbbb1" },
			{ question_id: "aaaaaaa2", note_id: "bbbbbbb1" },
			{ question_id: "aaaaaaa3", note_id: "zzzzzzzz" },
		],
		[{ id: "bbbbbbb1" }],
		now,
	);
	expect(r.closed).toEqual([{ id: "aaaaaaa1", note: "bbbbbbb1" }]);
	expect(r.questions[0]).toMatchObject({
		status: "answered",
		answeredBy: "bbbbbbb1",
	});
	expect(r.questions[2]?.status).toBe("open");
});

test("借りの台帳は、開いている確かめの問いと、最近閉じたものを足の状態から出す", () => {
	const qs = [
		q({ id: "a1", verify: true, createdAt: "2026-10-01T00:00:00Z" }),
		q({
			id: "a2",
			verify: true,
			status: "answered",
			lastVisitedAt: "2026-10-09T00:00:00Z",
		}),
		q({
			id: "a3",
			verify: true,
			status: "answered",
			lastVisitedAt: "2026-09-01T00:00:00Z",
		}),
		q({ id: "a4" }),
	];
	const d = debtLedger(qs, now);
	expect(d.open.map((x) => x.id)).toEqual(["a1"]);
	expect(d.closed.map((x) => x.id)).toEqual(["a2"]);
});

test("総称・全称・確度の語を含む文を拾う", () => {
	expect(
		sweepingSentences([
			"プロは必ず常温に戻す。焼き色は表面の乾きで決まる。どれも効くとは限らない。",
		]),
	).toEqual(["プロは必ず常温に戻す。", "どれも効くとは限らない。"]);
});

test("よそ者との会話の締めで総称の語の文を見せ、その主張から積む確かめの問いに印を付ける", async () => {
	const store = freshStore();
	let finalPrompt = "";
	await talkWithStranger({
		store,
		head: new FakeHead({
			dialogue: () => ({ reply: "プロは必ず肉を常温に戻します。" }),
			"dialogue-final": (req) => {
				finalPrompt = req.prompt;
				return {
					reply: "またね",
					new_questions: [],
					takeaway: "t",
					unverified: ["プロは必ず肉を常温に戻す"],
					accepted: [],
					about_self: [],
					pushed_back: [],
					spot_check: "",
				};
			},
		}),
		stranger: new FakeHead({ stranger: () => ({ reply: "肉の話をしよう" }) }),
		turns: 2,
		now,
		rng: () => 0.99,
	});
	expect(finalPrompt).toContain("総称・全称・確度の語");
	expect(store.questions().find((x) => x.verify)?.verifyKind).toBe("sweeping");
	expect(store.recentDialogues(1)[0]?.sweeping).toEqual([
		"プロは必ず肉を常温に戻します。",
	]);
});

test("「足します」と言ったのにどの欄にも積んでいない返事は、言い直させる", async () => {
	const store = freshStore();
	const head = new FakeHead({
		chat: () => ({ reply: "一覧に足します。", new_questions: [], crawl: [] }),
		"chat-rewrite": (req) => {
			expect(req.prompt).toContain("どの欄にも何も積んでいない");
			return { reply: "一覧には足せていません。" };
		},
	});
	const r = await chat(
		{ store, head, tools: [], now: () => now },
		"持ち主",
		[],
		"直すことに追加して",
	);
	expect(r.reply).toBe("一覧には足せていません。");
});
