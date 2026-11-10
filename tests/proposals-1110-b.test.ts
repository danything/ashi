import { describe, expect, test } from "bun:test";

import { TIRED_NOTE } from "../src/lib/server/ashi/head/claude.ts";
import {
  closeByNote,
  debtLedger,
  latestNoteByQuestion,
  scoreBreakdown,
  strangerLanding,
} from "../src/lib/server/ashi/legs/guard.ts";
import {
  batchResults,
  checkedNotes,
  score,
  selectQuestion,
  VERIFY_NOTE_MAX,
  walkedCount,
} from "../src/lib/server/ashi/legs/select.ts";
import { mainVerifyResult, step } from "../src/lib/server/ashi/legs/walk.ts";
import {
  EXPLORE_SCHEMA,
  explorePrompt,
} from "../src/lib/server/ashi/prompts.ts";
import type { Note } from "../src/lib/server/ashi/state.ts";
import { explore, FakeHead, freshStore, q } from "./helpers.ts";

const now = new Date("2026-11-10T12:00:00");

/** 歩く問いを 1 歩だけ歩かせる(前の歩みの眠りは解く) */
const walkOnce = (
  store: ReturnType<typeof freshStore>,
  answer: Record<string, unknown>,
) => {
  store.saveWalk({ ...store.walk(), sleepingUntil: undefined });
  const head = new FakeHead({ explore: () => explore(answer) });
  return step({ store, head, tools: [], now: () => now, rng: () => 0.1 }).then(
    (outcome) => ({ outcome, head }),
  );
};

/** 答えの形の欄(型は unknown なので、見る所だけ形を書く) */
const schemaProps = () =>
  EXPLORE_SCHEMA.properties as {
    incomplete: object;
    checked: {
      items: {
        properties: {
          result: { enum: string[] };
          note: { type: string };
        };
        required: string[];
      };
    };
  };

const walkedLog = (store: ReturnType<typeof freshStore>) =>
  store.recentLog(10).find((e) => e.event === "walked") as
    Record<string, unknown> | undefined;

/** 内省の頭の答え(何も変えない) */
const reflectReply = () => ({
  diary: "d",
  self: "私は寄り道が好きな歩き手で、問いの連鎖を追うのが楽しい。",
  next_steps: [],
  bridge_ideas: [],
  proposals: [],
  posts: [],
  merges: [],
  themes: [],
});

/** 1 歩歩かせて内省まで進め、内省に渡した文を返す */
const reflectPromptOf = async (store: ReturnType<typeof freshStore>) => {
  store.saveWalk({ ...store.walk(), steps: 4 });
  const head = new FakeHead({
    explore: () => explore(),
    reflect: reflectReply,
  });
  await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
  return head.calls.find((c) => c.task === "reflect")?.prompt ?? "";
};

const ctx = (notes: Note[] = []) =>
  ({
    notes,
    questions: [],
    feeds: "",
    intentions: [],
    bridges: [],
    recentThemes: [],
    resting: [],
    maxOpenPerTheme: 6,
  }) as unknown as Parameters<typeof explorePrompt>[2];

describe("P1: よそ者の問いの着地に、確かめの借りを数えない", () => {
  test("確かめの借りは total にも home にも入れず、本数だけ verify に返す", () => {
    const qs = [
      q({ id: "o", track: "owner", theme: "確かめること" }),
      q({ track: "self", theme: "アリの巣", source: "stranger" }),
      q({
        track: "self",
        theme: "確かめること",
        source: "stranger",
        verify: true,
      }),
      q({
        track: "self",
        theme: "確かめること",
        source: "stranger",
        verify: true,
      }),
      // 統合で消えた借りは、今までどおりどちらにも数えない
      q({
        track: "self",
        theme: "確かめること",
        source: "stranger",
        verify: true,
        mergedInto: "x",
      }),
    ];
    expect(strangerLanding(qs, [])).toEqual({
      home: 0,
      own: 0,
      total: 1,
      verify: 2,
    });
  });

  test("内省の文に、着地の数に入れていない借りの本数を書く", async () => {
    const store = freshStore(["a"]);
    store.saveQuestions([
      ...store.questions(),
      q({ track: "self", theme: "アリの巣", source: "stranger" }),
      q({
        track: "self",
        theme: "確かめること",
        source: "stranger",
        verify: true,
        status: "answered",
      }),
    ]);
    const p = await reflectPromptOf(store);
    expect(p).toContain("よそ者から来た個性の問い 1 本のうち");
    expect(p).toContain("確かめの借り 1 本は着地の数に入れていない");
  });

  test("借りが無ければ、内省の文に借りの注記を出さない", async () => {
    const store = freshStore(["a"]);
    store.saveQuestions([
      ...store.questions(),
      q({ track: "self", theme: "アリの巣", source: "stranger" }),
    ]);
    expect(await reflectPromptOf(store)).not.toContain(
      "着地の数に入れていない",
    );
  });
});

describe("P4: 確かめきれなかった歩みで点数を下げない", () => {
  test("歩いた回数から見つからなかった回数を引いて点数にする。下限は 0", () => {
    const fresh = score(q());
    expect(score(q({ visits: 1, misses: 1 }))).toBeCloseTo(fresh);
    expect(score(q({ visits: 2, misses: 2 }))).toBeCloseTo(fresh);
    expect(score(q({ visits: 3, misses: 2 }))).toBeCloseTo(
      score(q({ visits: 1 })),
    );
    // 確かめられた歩みは今までどおり 1 回ごとに −0.12、初めての加点も消える
    expect(score(q({ visits: 1 }))).toBeCloseTo(fresh - 0.15 - 0.12);
    expect(score(q({ visits: 2 }))).toBeCloseTo(fresh - 0.15 - 0.24);
    // misses の方が多い記録が残っていても、歩いた回数は負にならない
    expect(walkedCount({ visits: 1, misses: 3 })).toBe(0);
    expect(score(q({ visits: 1, misses: 3 }))).toBeCloseTo(fresh);
  });

  test("点数の内訳に、除いた回数を書く", () => {
    expect(scoreBreakdown(q({ visits: 0 }))).toContain(
      "まだ歩いていない +0.15",
    );
    expect(scoreBreakdown(q({ visits: 2 }))).toContain("歩いた 2 回 −0.24");
    expect(scoreBreakdown(q({ visits: 2, misses: 2 }))).toContain(
      "歩いた 2 回はどれも確かめきれなかったので、歩いていない扱い +0.15",
    );
    expect(scoreBreakdown(q({ visits: 3, misses: 1 }))).toContain(
      "歩いた 3 回のうち確かめきれなかった 1 回を除いて 2 回 −0.24",
    );
  });

  test("見つからない歩みを重ねても点数は下がらず、missesToPark 回で棚に移って歩かれなくなる", async () => {
    const store = freshStore();
    const target = q({ track: "owner" });
    store.saveQuestions([target]);
    const before = score(target);
    await walkOnce(store, { found: "none" });
    const once = store.questions().find((x) => x.id === target.id);
    expect(once).toMatchObject({ status: "open", visits: 1, misses: 1 });
    expect(score(once as never)).toBeCloseTo(before);
    await walkOnce(store, { found: "none" });
    const twice = store.questions().find((x) => x.id === target.id);
    expect(store.config().missesToPark).toBe(2);
    expect(twice).toMatchObject({ status: "parked", visits: 2, misses: 2 });
    // 棚に移った問いは、点数が高いままでも選ばれない
    const next = selectQuestion(
      store.questions(),
      store.walk().recentThemes,
      store.config(),
      () => 0.1,
      now,
    );
    expect("question" in next).toBe(false);
  });

  test("束ねた相手が読めなかったら、歩いた回数と一緒に見つからなかった回数が付き、点数は下がらない", async () => {
    const store = freshStore();
    const main = q({
      id: "main0001",
      track: "owner",
      verify: true,
      source: "stranger",
      via: "fake:地質",
      interest: 0.9,
      createdAt: "2026-11-01T00:00:00Z",
    });
    const mate = q({
      id: "mate0001",
      track: "owner",
      verify: true,
      source: "stranger",
      via: "fake:地質",
      interest: 0.2,
      createdAt: "2026-11-02T00:00:00Z",
    });
    store.saveQuestions([main, mate]);
    const before = score(mate);
    await walkOnce(store, {
      answered: true,
      found: "yes",
      checked: [
        { id: "main0001", result: "holds", note: "" },
        { id: "mate0001", result: "unreadable", note: "" },
      ],
    });
    expect(walkedLog(store)?.questionId).toBe("main0001");
    const after = store.questions().find((x) => x.id === "mate0001");
    expect(after).toMatchObject({
      status: "open",
      visits: 1,
      misses: 1,
      verifyResult: "unreadable",
    });
    expect(score(after as never)).toBeCloseTo(before);
  });

  test("問いを選ぶ決まりの説明に、数えない歩みを書く", () => {
    const p = explorePrompt(q(), "score", ctx());
    expect(p).toContain("歩いた回数に数えない");
  });
});

describe("P6: 新しく確かめられなかった歩み(incomplete)で問いを閉じない", () => {
  const debt = () =>
    q({
      id: "debt0001",
      text: "持ち主に記憶で言った、方言の敬語の分布の話は合っているか",
      track: "owner",
      theme: "確かめること",
      verify: true,
      source: "chat",
    });

  test("answered と incomplete を両方 true で返しても、問いは開いたままで、見つからなかった回数が付く", async () => {
    const store = freshStore();
    store.saveQuestions([debt()]);
    const { outcome } = await walkOnce(store, {
      answered: true,
      incomplete: true,
      found: "partial",
    });
    expect(outcome.kind).toBe("walked");
    expect(store.questions()[0]).toMatchObject({
      status: "open",
      visits: 1,
      misses: 1,
      verifyResult: "unreadable",
    });
    // ノートは残すが、答えのノートにしない印を付ける
    expect(store.notes()).toHaveLength(1);
    expect(store.notes()[0]?.incomplete).toBe(true);
    // 持ち主に「答えが出た」と渡さない
    expect(store.walk().ownerCorrections ?? []).toEqual([]);
    expect(walkedLog(store)).toMatchObject({
      answered: false,
      incomplete: true,
      parked: false,
    });
  });

  test("incomplete が続けば、missesToPark 回で棚に移る", async () => {
    const store = freshStore();
    store.saveQuestions([debt()]);
    await walkOnce(store, { answered: true, incomplete: true });
    await walkOnce(store, { answered: true, incomplete: true });
    expect(store.questions()[0]).toMatchObject({
      status: "parked",
      visits: 2,
      misses: 2,
    });
  });

  test("incomplete が無い・真偽値でないときは今までどおり閉じ、持ち主への答えを台帳に積む", async () => {
    for (const incomplete of [undefined, false, "true", 1]) {
      const store = freshStore();
      store.saveQuestions([debt()]);
      await walkOnce(store, {
        answered: true,
        found: "yes",
        ...(incomplete === undefined ? {} : { incomplete }),
      });
      expect(store.questions()[0]).toMatchObject({
        status: "answered",
        verifyResult: "holds",
      });
      expect(store.questions()[0]?.misses ?? 0).toBe(0);
      expect(store.notes()[0]?.incomplete).toBeUndefined();
      expect(store.walk().ownerCorrections).toMatchObject([
        { kind: "answer", questionId: "debt0001" },
      ]);
      expect(walkedLog(store)?.incomplete).toBeUndefined();
    }
  });

  test("incomplete のノートでは、also_answered の近い問いを閉じない(断ったことはログに残す)", async () => {
    const near = () =>
      q({
        id: "near0001",
        text: "持ち主に記憶で言った、方言の敬語の分布の話は合っているのか",
        track: "owner",
        interest: 0.1,
        importance: 0.1,
      });
    // 対照: incomplete でなければ閉じる
    const open = freshStore();
    open.saveQuestions([debt(), near()]);
    const done = await walkOnce(open, {
      answered: true,
      found: "yes",
      also_answered: ["near0001"],
    });
    expect(done.head.calls[0]?.prompt).toContain("near0001");
    expect(open.questions().find((x) => x.id === "near0001")?.status).toBe(
      "answered",
    );

    const store = freshStore();
    store.saveQuestions([debt(), near()]);
    await walkOnce(store, {
      answered: true,
      incomplete: true,
      also_answered: ["near0001"],
    });
    expect(store.questions().find((x) => x.id === "near0001")).toMatchObject({
      status: "open",
      visits: 0,
    });
    expect(walkedLog(store)).toMatchObject({ alsoRefused: ["near0001"] });
    expect(walkedLog(store)?.alsoAnswered).toBeUndefined();
  });

  test("incomplete の歩みでは、束ねた問いも閉じず、読めなかった扱いにする", async () => {
    const store = freshStore();
    store.saveQuestions([
      q({
        id: "main0001",
        track: "owner",
        verify: true,
        source: "stranger",
        via: "fake:地質",
        interest: 0.9,
      }),
      q({
        id: "mate0001",
        track: "owner",
        verify: true,
        source: "stranger",
        via: "fake:地質",
        interest: 0.2,
      }),
    ]);
    await walkOnce(store, {
      answered: true,
      incomplete: true,
      checked: [
        { id: "main0001", result: "holds", note: "" },
        { id: "mate0001", result: "wrong", note: "前のノートの言い方" },
      ],
    });
    for (const id of ["main0001", "mate0001"]) {
      const x = store.questions().find((y) => y.id === id);
      expect(x).toMatchObject({
        status: "open",
        visits: 1,
        misses: 1,
        verifyResult: "unreadable",
      });
      expect(x?.verifyNote).toBeUndefined();
    }
    expect(walkedLog(store)?.batch).toEqual({ mate0001: "unreadable" });
  });

  test("内省の close_by_note は、incomplete のノートを根拠にできない。断ったものを返す", () => {
    const qs = [q({ id: "aaaaaaa1" }), q({ id: "aaaaaaa2" })];
    const r = closeByNote(
      qs,
      [
        { question_id: "aaaaaaa1", note_id: "bbbbbbb1" },
        { question_id: "aaaaaaa2", note_id: "bbbbbbb2" },
      ],
      [{ id: "bbbbbbb1", incomplete: true }, { id: "bbbbbbb2" }],
      now,
    );
    expect(r.closed).toEqual([{ id: "aaaaaaa2", note: "bbbbbbb2" }]);
    expect(r.refused).toEqual([{ id: "aaaaaaa1", note: "bbbbbbb1" }]);
    expect(r.questions[0]?.status).toBe("open");
    expect(r.questions[0]?.answeredBy).toBeUndefined();
  });

  test("内省で incomplete のノートを根拠に閉じようとしても閉じず、ログに残す", async () => {
    const store = freshStore(["a"]);
    const other = q({ id: "other001", track: "owner", interest: 0.1 });
    store.saveQuestions([...store.questions(), other]);
    store.addNote(
      {
        id: "note0001",
        title: "束ね直し",
        theme: "t",
        questionId: "gone0001",
        summary: "前のノートをまとめ直した",
        createdAt: "2026-11-09T00:00:00Z",
        incomplete: true,
      },
      "# 束ね直し\n\n本文",
    );
    store.saveWalk({ ...store.walk(), steps: 4 });
    const head = new FakeHead({
      explore: () => explore(),
      reflect: () => ({
        ...reflectReply(),
        close_by_note: [{ question_id: "other001", note_id: "note0001" }],
      }),
    });
    await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
    expect(store.questions().find((x) => x.id === "other001")?.status).toBe(
      "open",
    );
    const log = store.recentLog(10).find((e) => e.event === "reflected") as
      Record<string, unknown> | undefined;
    expect(log?.closeRefused).toEqual([{ id: "other001", note: "note0001" }]);
    expect(log?.closedByNote).toBeUndefined();
  });

  test("借りの台帳の答えのノートに、incomplete のノートを出さない", () => {
    const note = (over: Partial<Note>): Note => ({
      id: "n",
      title: "題",
      theme: "t",
      questionId: "a1",
      summary: "",
      createdAt: "2026-11-01T00:00:00Z",
      ...over,
    });
    const notes = [
      note({ id: "n1", title: "確かめた" }),
      note({
        id: "n2",
        title: "束ね直し",
        createdAt: "2026-11-05T00:00:00Z",
        incomplete: true,
      }),
      note({
        id: "n3",
        questionId: "a2",
        createdAt: "2026-11-05T00:00:00Z",
        incomplete: true,
      }),
    ];
    expect(latestNoteByQuestion(notes)).toEqual({
      a1: { id: "n1", title: "確かめた" },
    });
    expect(
      debtLedger([q({ id: "a1", verify: true })], now, 14, notes).notes,
    ).toEqual({ a1: { id: "n1", title: "確かめた" } });
  });

  test("歩くときに見せる最近のノートに、未完の印を付ける", () => {
    const p = explorePrompt(
      q(),
      "score",
      ctx([
        {
          id: "n1",
          title: "束ね直し",
          theme: "t",
          questionId: "a1",
          summary: "前のノートをまとめ直した",
          createdAt: "2026-11-05T00:00:00Z",
          incomplete: true,
        },
        {
          id: "n2",
          title: "確かめた",
          theme: "t",
          questionId: "a2",
          summary: "読めた",
          createdAt: "2026-11-06T00:00:00Z",
        },
      ]),
    );
    expect(p).toContain("前のノートをまとめ直した ※未完");
    expect(p).not.toContain("読めた ※未完");
    expect(p).toContain("incomplete を true、answered を false");
  });

  test("答えの形に incomplete があり、道具を取り上げたときの文でも頼む", () => {
    expect(schemaProps().incomplete).toMatchObject({
      type: "boolean",
    });
    expect(EXPLORE_SCHEMA.required).toContain("incomplete");
    expect(TIRED_NOTE).toContain("incomplete を true、answered を false");
  });
});

describe("P14: 核は合い、言い足しだけ外れた確かめの結果(overstated)", () => {
  test("束ねた問いの結果と添えた一行を受け取る。一行は足が切る", () => {
    const sib = [q({ id: "s1", verify: true }), q({ id: "s2", verify: true })];
    const raw = [
      { id: "s1", result: "overstated", note: "  「現在まで」が\n言い過ぎ  " },
      { id: "s2", result: "mostly", note: "知らない値" },
      { id: "zz", result: "overstated", note: "束ねていない問い" },
      { id: "s3", result: "wrong", note: "あ".repeat(500) },
      { id: "s4", result: "holds", note: "" },
      { id: "s5", result: "holds", note: 3 },
    ];
    expect([...batchResults(raw, sib)]).toEqual([["s1", "overstated"]]);
    const notes = checkedNotes(raw);
    expect(notes.get("s1")).toBe("「現在まで」が 言い過ぎ");
    expect(notes.get("s3")).toHaveLength(VERIFY_NOTE_MAX);
    expect(notes.has("s4")).toBe(false);
    expect(notes.has("s5")).toBe(false);
    expect(checkedNotes("x").size).toBe(0);
  });

  test("歩いた確かめの問いは、checked に自分の ID があればそれを優先し、無ければ今までどおり推す", () => {
    const v = q({ id: "v", verify: true });
    expect(
      mainVerifyResult(v, {
        checked: [{ id: "v", result: "overstated", note: "言い過ぎ" }],
        correction: "言い方を直す",
        answered: true,
        found: "yes",
      }),
    ).toBe("overstated");
    expect(
      mainVerifyResult(v, {
        checked: [{ id: "other", result: "overstated" }],
        correction: "違った",
        answered: true,
        found: "yes",
      }),
    ).toBe("wrong");
    expect(
      mainVerifyResult(v, {
        checked: [{ id: "v", result: "mostly" as never }],
        correction: "",
        answered: true,
        found: "yes",
      }),
    ).toBe("holds");
    // 新しく確かめられなかった歩みは、何を書いていても読めなかった扱い
    expect(
      mainVerifyResult(v, {
        checked: [{ id: "v", result: "overstated" }],
        correction: "",
        answered: true,
        found: "yes",
        incomplete: true,
      }),
    ).toBe("unreadable");
  });

  test("一本で歩いた確かめの問いを overstated で閉じ、外れた語句を残す", async () => {
    const store = freshStore();
    store.saveQuestions([
      q({ id: "solo0001", track: "owner", verify: true, source: "stranger" }),
    ]);
    const { head } = await walkOnce(store, {
      answered: true,
      found: "yes",
      checked: [
        {
          id: "solo0001",
          result: "overstated",
          note: `「現在まで引き延ばした」が言い過ぎ${"。".repeat(300)}`,
        },
      ],
    });
    // 一本のときも、自分の ID で checked に書かせる
    expect(head.calls[0]?.prompt).toContain(
      "結果を checked に、この問いの ID(solo0001)で入れてください",
    );
    expect(head.calls[0]?.prompt).toContain(
      "overstated: 核は合い、言い足しが外れていた",
    );
    const after = store.questions()[0];
    expect(after).toMatchObject({
      status: "answered",
      verifyResult: "overstated",
    });
    expect(after?.verifyNote).toStartWith("「現在まで引き延ばした」が言い過ぎ");
    expect(after?.verifyNote).toHaveLength(VERIFY_NOTE_MAX);
  });

  test("確かめの問いでなければ、checked の指示を出さない", () => {
    expect(explorePrompt(q({ id: "plain001" }), "score", ctx())).not.toContain(
      "結果を checked に、この問いの ID",
    );
  });

  test("束ねた問いは overstated でも閉じ(外れと同じ)、外れた語句を残す。合うものに一行は残さない", async () => {
    const store = freshStore();
    const v = (id: string, interest: number) =>
      q({
        id,
        track: "owner",
        verify: true,
        source: "stranger",
        via: "fake:地質",
        interest,
        createdAt: `2026-11-0${id.slice(-1)}T00:00:00Z`,
      });
    store.saveQuestions([
      v("main0001", 0.9),
      v("mate0002", 0.2),
      v("mate0003", 0.2),
    ]);
    const { head } = await walkOnce(store, {
      answered: true,
      found: "yes",
      checked: [
        { id: "main0001", result: "holds", note: "" },
        { id: "mate0002", result: "overstated", note: "「必ず」が言い過ぎ" },
        { id: "mate0003", result: "holds", note: "合っていた" },
      ],
    });
    expect(head.calls[0]?.prompt).toContain(
      "合う / 核は合い言い足しが外れ / 外れ / 読めなかった",
    );
    const by = (id: string) => store.questions().find((x) => x.id === id);
    expect(by("mate0002")).toMatchObject({
      status: "answered",
      verifyResult: "overstated",
      verifyNote: "「必ず」が言い過ぎ",
      visits: 1,
    });
    expect(by("mate0002")?.misses ?? 0).toBe(0);
    expect(by("mate0003")).toMatchObject({
      status: "answered",
      verifyResult: "holds",
    });
    expect(by("mate0003")?.verifyNote).toBeUndefined();
    expect(walkedLog(store)?.batch).toEqual({
      mate0002: "overstated",
      mate0003: "holds",
    });
  });

  test("内省の借りの台帳で、言い足しだけ外れた借りを、核ごと外れた借りと分けて見せる", async () => {
    const store = freshStore(["a"]);
    const closed = (id: string, over: object) =>
      q({
        id,
        verify: true,
        source: "stranger",
        via: "fake:地質",
        status: "answered",
        lastVisitedAt: "2026-11-09T00:00:00Z",
        createdAt: "2026-11-08T00:00:00Z",
        ...over,
      });
    store.saveQuestions([
      ...store.questions(),
      closed("over0001", {
        verifyResult: "overstated",
        verifyNote: "「現在まで」が言い過ぎ",
      }),
      closed("wrng0001", { verifyResult: "wrong", verifyNote: "年が違う" }),
      closed("wrng0002", { verifyResult: "wrong" }),
      closed("hold0001", { verifyResult: "holds" }),
    ]);
    const p = await reflectPromptOf(store);
    expect(p).toContain(
      "結果の内訳: 合う 1 本・核は合い言い足しが外れ 1 本・外れ 2 本",
    );
    expect(p).toContain(
      "[over0001] 答えた・核は合い言い足しが外れ(外れた語句: 「現在まで」が言い過ぎ)",
    );
    expect(p).toContain("[wrng0001] 答えた・外れ(");
    expect(p).toContain("言い足しの例を集めるときは「外れ」と混ぜない");
  });

  test("答えの形の checked に overstated と note がある", () => {
    const item = schemaProps().checked.items;
    expect(item.properties.result.enum).toEqual([
      "holds",
      "overstated",
      "wrong",
      "unreadable",
    ]);
    expect([...item.required].sort()).toEqual(
      Object.keys(item.properties).sort(),
    );
    expect(item.properties.note.type).toBe("string");
  });
});
