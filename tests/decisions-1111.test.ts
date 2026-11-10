import { describe, expect, test } from "bun:test";

import {
  markDelivered,
  pendingCorrections,
  unsaidFixes,
  withdrawCorrections,
} from "../src/lib/server/ashi/legs/guard.ts";
import { selectQuestion } from "../src/lib/server/ashi/legs/select.ts";
import {
  FIELD_REST,
  openByField,
  pickField,
  STRANGER_FIELDS,
} from "../src/lib/server/ashi/legs/stranger.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
import { correctionsBlock } from "../src/lib/server/ashi/prompts.ts";
import type { Store } from "../src/lib/server/ashi/state.ts";
import { explore, FakeHead, freshStore, q } from "./helpers.ts";

// 持ち主が任せた 4 つの判断(2026-11-11)

const now = new Date("2026-11-11T12:00:00");
const at = (local: string) => new Date(local).toISOString();

const cfg = {
  themeStreakLimit: 3,
  themeWindow: 10,
  themeWindowMax: 3,
  detourRate: 0,
  ownerShare: 0.5,
};

describe("問い探しに回すかは、先に回すもの(確かめ・約束)を見てから決める", () => {
  test("さいころの系統に歩ける問いが無くても、持ち主への借りを先に歩く", () => {
    const debt = q({
      track: "self",
      theme: "確かめること",
      verify: true,
      source: "chat",
      createdAt: now.toISOString(),
    });
    // さいころは owner(0.1 < 0.5)。owner の系統には問いが 1 本も無い
    const c = selectQuestion([debt], [], cfg, () => 0.1, now);
    expect(c).toMatchObject({
      question: { id: debt.id },
      track: "self",
      reason: "verify",
    });
  });

  test("系統の問いが全部休みでも、次の一歩に 2 回書いた問いを歩く", () => {
    const promised = q({ track: "owner", theme: "休み", promised: 2 });
    const other = q({ track: "owner", theme: "休み", interest: 1 });
    const c = selectQuestion(
      [other, promised],
      ["休み", "休み", "休み"],
      cfg,
      () => 0.1,
      now,
    );
    expect(c).toMatchObject({
      question: { id: promised.id },
      track: "owner",
      reason: "promised",
    });
  });

  test("先に回すものが無ければ、これまでどおりその系統の問いを探させる", () => {
    const resting = q({ track: "owner", theme: "休み" });
    // もう一方の系統の問い・歩いたことのある借りでは、問い探しは止まらない
    const walkedDebt = q({
      track: "self",
      theme: "確かめること",
      verify: true,
      source: "chat",
      visits: 1,
    });
    const self = q({ track: "self", interest: 1 });
    expect(
      selectQuestion(
        [resting, walkedDebt, self],
        ["休み", "休み", "休み"],
        cfg,
        () => 0.1,
        now,
      ),
    ).toEqual({ seed: "owner", avoid: ["休み"] });
  });
});

describe("よそ者の分野は、最近の分野を外し、開いた持ち帰りの多い分野を引きにくくする", () => {
  const stranger = (field: string, over = {}) =>
    q({ source: "stranger", via: `fake:${field}`, ...over });

  test("直前 FIELD_REST 回の分野は選ばない", () => {
    expect(FIELD_REST).toBe(10);
    const recent = STRANGER_FIELDS.slice(0, FIELD_REST);
    for (let i = 0; i < 50; i++) {
      const { field } = pickField([...recent], [], () => i / 50);
      expect(recent).not.toContain(field);
    }
    // さいころが 0 なら、残った分野の先頭
    expect(pickField([...recent], [], () => 0).field).toBe(
      STRANGER_FIELDS[FIELD_REST],
    );
    // 全部が直前に出ていたら(分野を減らしたときなど)、外さずに振る
    expect(pickField([...STRANGER_FIELDS], [], () => 0).field).toBe(
      STRANGER_FIELDS[0],
    );
  });

  test("数えるのは、その分野の会話から持ち帰った、開いた確かめでない問いだけ", () => {
    const open = openByField([
      stranger("地質学"),
      stranger("地質学"),
      stranger("地質学", { verify: true }),
      stranger("地質学", { status: "answered" }),
      stranger("音楽"),
      q({ source: "chat", via: "fake:地質学" }),
      q({ source: "stranger" }),
    ]);
    expect([...open]).toEqual([
      ["地質学", 2],
      ["音楽", 1],
    ]);
  });

  test("持ち帰りが開いている分野は、1 / (1 + 本数) の重みで引く", () => {
    const [first, second] = STRANGER_FIELDS;
    // 先頭の分野に 3 本開いている: 重みは 0.25、ほかは 1。合計 19.25
    const qs = [stranger(first), stranger(first), stranger(first)];
    const total = 0.25 + (STRANGER_FIELDS.length - 1);
    expect(pickField([], qs, () => 0.2 / total)).toEqual({
      field: first,
      open: 3,
    });
    // 重みが無ければ先頭の分野に当たる目(0.5 / 20)でも、次の分野へ移る
    expect(pickField([], qs, () => 0.5 / total)).toEqual({
      field: second,
      open: 0,
    });
    expect(pickField([], [], () => 0.5 / STRANGER_FIELDS.length).field).toBe(
      first,
    );
    // さいころが上の端でも、最後の分野に収まる
    expect(pickField([], qs, () => 0.999999).field).toBe(
      STRANGER_FIELDS[STRANGER_FIELDS.length - 1] as string,
    );
  });
});

describe("訂正は話題が合うときに話すまま、あることを足が見せ、重なりは内省が取り下げられる", () => {
  const ledger = [
    { id: "f1", text: "締め切りの数え方", at: at("2026-10-27T09:00:00") },
    { id: "f2", text: "同じ話の言い換え", at: at("2026-11-02T09:00:00") },
    {
      id: "v1",
      text: "足が確かめて外れていた",
      at: at("2026-11-03T09:00:00"),
      questionId: "q1",
    },
    {
      id: "a1",
      text: "聞かれた件は合っていた",
      at: at("2026-11-04T09:00:00"),
      kind: "answer" as const,
    },
    {
      id: "d1",
      text: "もう渡した",
      at: at("2026-10-20T09:00:00"),
      deliveredAt: at("2026-11-09T10:00:00"),
    },
  ];

  test("話す画面に出す数は、まだ伝えていない訂正だけ(確かめた答えと渡したものは数えない)", () => {
    expect(unsaidFixes(ledger)).toEqual({
      count: 3,
      oldest: at("2026-10-27T09:00:00"),
    });
    expect(unsaidFixes(undefined)).toEqual({ count: 0 });
    expect(unsaidFixes(ledger.slice(3))).toEqual({ count: 0 });
  });

  test("持ち主が画面で読んだ印は、話して渡した印と区別する", () => {
    const read = markDelivered(ledger, ["f1"], now, "read");
    expect(read.delivered).toEqual(["f1"]);
    expect(read.ledger.find((c) => c.id === "f1")).toMatchObject({
      deliveredAt: now.toISOString(),
      deliveredBy: "read",
    });
    const told = markDelivered(ledger, ["f1"], now);
    expect(told.ledger.find((c) => c.id === "f1")?.deliveredBy).toBeUndefined();
  });

  test("取り下げられるのは内省が自分で書いた、まだ渡していないものだけ", () => {
    const out = withdrawCorrections(ledger, [
      "f2",
      "v1",
      "a1",
      "d1",
      "zzzz",
      3,
    ]);
    expect(out.withdrawn.map((c) => c.id)).toEqual(["f2"]);
    // 足が確かめた訂正・答えは、頭には外せない
    expect(out.refused).toEqual(["v1", "a1"]);
    expect(out.ledger.map((c) => c.id)).toEqual(["f1", "v1", "a1", "d1"]);
    expect(withdrawCorrections(ledger, "f2").withdrawn).toEqual([]);
    expect(withdrawCorrections(undefined, ["f2"]).ledger).toEqual([]);
  });

  test("話すときの頼み方: 関係する話題か、持ち主が訂正を聞きたいと言ったとき", () => {
    const block = correctionsBlock(
      [{ id: "f1", text: "締め切りの数え方", at: "" }],
      "relevant",
    );
    expect(block).toContain("持ち主が訂正を聞きたいと言ったとき");
    expect(block).toContain("まだ伝えていない訂正");
    expect(
      correctionsBlock(
        [{ id: "f1", text: "締め切りの数え方", at: "" }],
        "first",
      ),
    ).toContain("返事の最初に短く伝えてください");
  });

  const reflectAnswer = (over: Record<string, unknown> = {}) => ({
    diary: "d",
    self: "私は寄り道が好きな歩き手で、問いの連鎖を追うのが楽しい。",
    next_steps: [],
    bridge_ideas: [],
    proposals: [],
    posts: [],
    merges: [],
    themes: [],
    owner_corrections: [],
    withdrawn_corrections: [],
    ...over,
  });

  /** 1 歩歩いて内省まで進め、内省に渡したプロンプトを返す */
  async function reflectOnce(
    store: Store,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const w = store.walk();
    store.saveWalk({
      ...w,
      steps: w.lastReflectStep + 4,
      sleepingUntil: undefined,
    });
    const head = new FakeHead({
      profile: () => ({ owner: "# 持ち主の興味の地図", new_questions: [] }),
      explore: () => explore(),
      reflect: () => reflectAnswer(over),
    });
    await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
    const prompt = head.calls.find((c) => c.task === "reflect")?.prompt;
    expect(prompt).toBeDefined();
    return prompt ?? "";
  }

  test("内省に印を見せ、取り下げたものを外してから、まとめ直した文を積む", async () => {
    const store = freshStore(["a"]);
    store.saveWalk({
      ...store.walk(),
      ownerCorrections: [
        {
          id: "f1",
          text: "ブドウ糖の研究は追試で再現しなかったと言い損ねた",
          at: at("2026-10-27T09:00:00"),
        },
        {
          id: "f2",
          text: "ブドウ糖の研究が追試で再現しなかったことを言い損ねている",
          at: at("2026-11-02T09:00:00"),
        },
        {
          id: "v1",
          text: "時差の数字は足が確かめて外れていた",
          at: at("2026-11-03T09:00:00"),
          questionId: "q1",
        },
        {
          id: "r1",
          text: "画面で読んでもらった訂正",
          at: at("2026-11-01T09:00:00"),
          deliveredAt: at("2026-11-10T09:00:00"),
          deliveredBy: "read",
        },
      ],
    });
    const prompt = await reflectOnce(store, {
      withdrawn_corrections: ["f1", "f2", "v1"],
      // 取り下げた 2 本とほぼ同じ文でも、外した後なので積める
      owner_corrections: ["ブドウ糖の研究は追試で再現しなかったと言い損ねた。"],
    });
    expect(prompt).toContain("[v1] (足が確かめた訂正)");
    expect(prompt).toContain("[r1] (持ち主が画面で読んだ)");
    expect(prompt).toContain("withdrawn_corrections に ID を書けば");
    expect(prompt).toContain("持ち主が訂正を聞きたいと言ったとき");

    const after = store.walk().ownerCorrections ?? [];
    const pending = pendingCorrections(after);
    expect(pending.map((c) => c.id)).not.toContain("f1");
    expect(pending.map((c) => c.id)).not.toContain("f2");
    expect(pending.map((c) => c.id)).toContain("v1");
    expect(pending).toHaveLength(2);
    expect(pending.at(-1)?.text).toBe(
      "ブドウ糖の研究は追試で再現しなかったと言い損ねた。",
    );
    // 内省で一度見せた「渡したもの」は落とす
    expect(after.some((c) => c.id === "r1")).toBe(false);
    const log = store
      .recentLog(10)
      .find((e) => e.event === "corrections-withdrawn") as
      { withdrawn: { id: string }[]; refused?: string[] } | undefined;
    expect(log?.withdrawn.map((c) => c.id)).toEqual(["f1", "f2"]);
    expect(log?.refused).toEqual(["v1"]);
  });

  test("取り下げが無ければ、台帳もログも変わらない", async () => {
    const store = freshStore(["a"]);
    store.saveWalk({
      ...store.walk(),
      ownerCorrections: [
        { id: "f1", text: "言い損ねたこと", at: at("2026-10-27T09:00:00") },
      ],
    });
    await reflectOnce(store);
    expect(store.walk().ownerCorrections?.map((c) => c.id)).toEqual(["f1"]);
    expect(
      store.recentLog(10).some((e) => e.event === "corrections-withdrawn"),
    ).toBe(false);
  });
});
