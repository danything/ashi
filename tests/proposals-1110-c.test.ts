import { describe, expect, test } from "bun:test";

import { chat } from "../src/lib/server/ashi/legs/chat.ts";
import {
  addOwnerCorrections,
  CLAIM_NOTE_MIN,
  claimNotes,
  dropShownDelivered,
  markDelivered,
  ownerHandoffs,
  patternsByReply,
  pendingCorrections,
} from "../src/lib/server/ashi/legs/guard.ts";
import { talkWithStranger } from "../src/lib/server/ashi/legs/stranger.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
import { correctionsBlock } from "../src/lib/server/ashi/prompts.ts";
import type { Dialogue, Note, Store } from "../src/lib/server/ashi/state.ts";
import { explore, FakeHead, freshStore, q } from "./helpers.ts";

const now = new Date("2026-11-10T12:00:00");
const at = (local: string) => new Date(local).toISOString();

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
  ...over,
});

/** 1 歩歩いて内省まで進め、内省に渡したプロンプトを返す */
async function reflectOnce(
  store: Store,
  over: Record<string, unknown> = {},
): Promise<string> {
  const w = store.walk();
  // 前の歩みの休みは起こしておく(同じ時刻で続けて内省させるため)
  store.saveWalk({
    ...w,
    steps: w.lastReflectStep + 4,
    sleepingUntil: undefined,
  });
  const head = new FakeHead({
    // 持ち主との対話が増えていたら、地図の書き直しが先に来る
    profile: () => ({ owner: "# 持ち主の興味の地図", new_questions: [] }),
    explore: () => explore(),
    reflect: () => reflectAnswer(over),
  });
  await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
  const prompt = head.calls.find((c) => c.task === "reflect")?.prompt;
  expect(prompt).toBeDefined();
  return prompt ?? "";
}

const chatAnswer = (over: Record<string, unknown> = {}) => ({
  reply: "先に訂正です",
  stances: [],
  unverified: [],
  delivered_corrections: [],
  new_questions: [],
  crawl: [],
  ...over,
});

/** 文字の組が重ならない文(近い重複としてはじかれないように) */
const distinct = (i: number) =>
  Array.from({ length: 12 }, (_, k) =>
    String.fromCodePoint(0x4e00 + i * 50 + k),
  ).join("");

describe("持ち主に渡すものの台帳に、渡した印を付ける(P7・P8・P11)", () => {
  test("対話で渡したものは消さずに印を付け、次の対話には出さない", async () => {
    const store = freshStore(["a"]);
    store.saveWalk({
      ...store.walk(),
      // deliveredAt の無い古い形は、まだ渡していないものとして読む
      ownerCorrections: [
        {
          id: "c1",
          text: "追試で再現しなかったと言い損ねた",
          at: at("2026-11-01T09:00:00"),
        },
        {
          id: "c2",
          text: "別の件は来週に確かめる",
          at: at("2026-11-02T09:00:00"),
        },
      ],
    });
    const head = new FakeHead({
      // 台帳に無い ID を申告しても、何も起きない
      chat: () => chatAnswer({ delivered_corrections: ["c1", "zzzz"] }),
    });
    await chat(
      { store, head, tools: [], now: () => now },
      "持ち主",
      [],
      "やあ",
    );
    expect(head.calls[0]?.prompt).toContain("[c1]");
    expect(head.calls[0]?.prompt).toContain("[c2]");
    const ledger = store.walk().ownerCorrections ?? [];
    expect(ledger).toHaveLength(2);
    expect(ledger.find((c) => c.id === "c1")?.deliveredAt).toBe(
      now.toISOString(),
    );
    expect(ledger.find((c) => c.id === "c2")?.deliveredAt).toBeUndefined();
    expect(pendingCorrections(ledger).map((c) => c.id)).toEqual(["c2"]);
    expect(
      store.recentLog(5).find((e) => e.event === "chat")?.delivered,
    ).toEqual(["c1"]);

    const next = new FakeHead({ chat: () => chatAnswer() });
    await chat(
      { store, head: next, tools: [], now: () => now },
      "持ち主",
      [],
      "続き",
    );
    expect(next.calls[0]?.prompt).not.toContain("[c1]");
    expect(next.calls[0]?.prompt).toContain("[c2]");
  });

  test("返事が空だったら、申告があっても渡したことにしない", async () => {
    const store = freshStore(["a"]);
    store.saveWalk({
      ...store.walk(),
      ownerCorrections: [
        { id: "c1", text: "言い損ねたこと", at: at("2026-11-01T09:00:00") },
      ],
    });
    const head = new FakeHead({
      chat: () => chatAnswer({ reply: "", delivered_corrections: ["c1"] }),
    });
    await chat(
      { store, head, tools: [], now: () => now },
      "持ち主",
      [],
      "やあ",
    );
    expect(store.walk().ownerCorrections?.[0]?.deliveredAt).toBeUndefined();
  });

  test("話すときに見せる形は、渡した印の付いたものを出さない", () => {
    const block = correctionsBlock(
      [
        {
          id: "c1",
          text: "渡した訂正",
          at: "",
          deliveredAt: now.toISOString(),
        },
        { id: "c2", text: "まだの訂正", at: "" },
      ],
      "relevant",
    );
    expect(block).not.toContain("[c1]");
    expect(block).toContain("[c2]");
    expect(block).toContain("足が渡した印を付け、次の内省で見せます");
    expect(
      correctionsBlock(
        [{ id: "c1", text: "渡した訂正", at: "", deliveredAt: "x" }],
        "first",
      ),
    ).toBe("");
  });

  test("印を付ける・落とす・数える(足の関数)", () => {
    const ledger = [
      { id: "p1", text: "まだ", at: at("2026-11-03T09:00:00") },
      {
        id: "d1",
        text: "渡した",
        at: at("2026-11-02T09:00:00"),
        deliveredAt: at("2026-11-09T10:00:00"),
      },
    ];
    // 渡したものにもう一度印を付けない(渡した時刻を書き換えない)
    const again = markDelivered(ledger, ["d1", "p1", 3], now);
    expect(again.delivered).toEqual(["p1"]);
    expect(again.ledger.find((c) => c.id === "d1")?.deliveredAt).toBe(
      at("2026-11-09T10:00:00"),
    );
    expect(markDelivered(ledger, "p1", now).delivered).toEqual([]);
    // 内省で見せたものだけ落とす。見せた後に渡ったもの(d2)は次の内省まで残す
    expect(
      dropShownDelivered(
        [...ledger, { id: "d2", text: "後で渡した", at: "", deliveredAt: "x" }],
        ["d1", "p1"],
      ).map((c) => c.id),
    ).toEqual(["p1", "d2"]);
    const h = ownerHandoffs(
      ledger,
      [
        { at: at("2026-11-09T10:00:00") },
        { at: at("2026-11-08T13:00:00") },
        { at: at("2026-11-07T10:00:00") },
      ],
      at("2026-11-08T12:00:00"),
    );
    expect(h.pending.map((c) => c.id)).toEqual(["p1"]);
    expect(h.delivered.map((c) => c.id)).toEqual(["d1"]);
    expect(h.chats).toEqual({ count: 2, lastAt: at("2026-11-09T10:00:00") });
    expect(ownerHandoffs(undefined, [], undefined).chats).toEqual({
      count: 0,
      lastAt: undefined,
    });
  });

  test("まだ渡していないものは 20 件まで。渡したものは数に入れず、7 日で落とし、近い文は積み直さない", () => {
    const pending = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      text: distinct(i),
      at: at("2026-11-01T09:00:00"),
    }));
    const fresh = {
      id: "d1",
      text: "ブドウ糖の研究は追試で再現しなかったと伝える",
      at: at("2026-11-01T09:00:00"),
      deliveredAt: at("2026-11-09T10:00:00"),
    };
    const stale = {
      id: "d0",
      text: distinct(90),
      at: at("2026-10-20T09:00:00"),
      deliveredAt: at("2026-11-01T10:00:00"),
    };
    const out = addOwnerCorrections(
      [stale, fresh, ...pending],
      [
        distinct(40),
        // 渡したばかりのこととほぼ同じ文
        "ブドウ糖の研究は追試で再現しなかったと伝える。",
      ],
      now,
    );
    expect(pendingCorrections(out)).toHaveLength(20);
    // 古い 1 本(p0)を手放し、新しい 1 本を入れる
    expect(out.some((c) => c.id === "p0")).toBe(false);
    expect(out.at(-1)?.text).toBe(distinct(40));
    expect(out.filter((c) => c.deliveredAt).map((c) => c.id)).toEqual(["d1"]);
  });

  test("内省に、まだ渡していないもの・渡したもの・対話があったかを見せ、見せた「渡したもの」を落とす", async () => {
    const store = freshStore(["a"]);
    store.saveWalk({
      ...store.walk(),
      lastSelf: {
        at: at("2026-11-08T12:00:00"),
        result: "unchanged",
        declared: 0,
      },
      ownerCorrections: [
        {
          id: "d1",
          text: "ブドウ糖の研究は追試で再現しなかった",
          at: at("2026-11-02T09:00:00"),
        },
        {
          id: "p1",
          text: "締め切りの数え方を言い間違えた",
          at: at("2026-11-03T09:00:00"),
        },
        {
          id: "a1",
          text: "聞かれた件は合っていた",
          at: at("2026-11-04T09:00:00"),
          kind: "answer",
        },
      ],
    });
    // 前回の内省より前の対話は数えない
    store.appendChat({
      at: at("2026-11-07T10:00:00"),
      by: "持ち主",
      question: "前の話",
      reply: "前の返事",
      usd: 0,
    });
    const talkedAt = new Date("2026-11-09T10:30:00");
    await chat(
      {
        store,
        head: new FakeHead({
          chat: () => chatAnswer({ delivered_corrections: ["d1"] }),
        }),
        tools: [],
        now: () => talkedAt,
      },
      "持ち主",
      [],
      "こんにちは",
    );

    const prompt = await reflectOnce(store, {
      owner_corrections: [
        // 渡したばかりのことを書き直しても、積み直さない
        "ブドウ糖の研究は追試で再現しなかった。",
        "歩数の上限を持ち主に見直してもらいたい",
      ],
    });
    expect(prompt).toContain("持ち主に渡すものの台帳");
    expect(prompt).toContain(
      "前回の内省の後、持ち主との対話は 1 回あった(最後は 11-09 10:30)。",
    );
    expect(prompt).toContain(
      "まだ渡していないもの(2 本。日付は台帳に置いた日):",
    );
    expect(prompt).toContain("- 11-03 [p1] 締め切りの数え方を言い間違えた");
    expect(prompt).toContain(
      "- 11-04 [a1] (確かめた答え)聞かれた件は合っていた",
    );
    expect(prompt).toContain("前回の内省の後に渡したもの(1 本。");
    expect(prompt).toContain(
      "- 11-09 [d1] ブドウ糖の研究は追試で再現しなかった",
    );
    // 出し方の設定(既定は relevant)も伝える。対話があっても渡っていないことがある
    expect(prompt).toContain("関係するときにだけ伝える");

    const ledger = store.walk().ownerCorrections ?? [];
    expect(ledger.some((c) => c.id === "d1")).toBe(false);
    expect(ledger.map((c) => c.text)).toEqual([
      "締め切りの数え方を言い間違えた",
      "聞かれた件は合っていた",
      "歩数の上限を持ち主に見直してもらいたい",
    ]);

    // 次の内省: 渡したものはもう出ない。対話が無かったことを言う
    const next = await reflectOnce(store);
    expect(next).toContain(
      "前回の内省の後、持ち主との対話は無かった(渡す機会が無かった)。",
    );
    expect(next).toContain("まだ渡していないもの(3 本。");
    expect(next).toContain("前回の内省の後に渡したもの(0 本。");
    expect(next).not.toContain("[d1]");
  });

  test("まだ渡していないものが 10 本を超えたら、新しい 10 本と、残りの本数といちばん古い日付", async () => {
    const store = freshStore(["a"]);
    store.saveWalk({
      ...store.walk(),
      ownerCorrections: Array.from({ length: 12 }, (_, i) => ({
        id: `p${String(i).padStart(2, "0")}`,
        text: distinct(i),
        at: at(`2026-10-${27 + Math.min(i, 4)}T09:00:00`),
      })),
    });
    const prompt = await reflectOnce(store);
    expect(prompt).toContain("まだ渡していないもの(12 本。");
    expect(prompt).not.toContain("[p01]");
    expect(prompt).toContain("[p02]");
    expect(prompt).toContain("[p11]");
    expect(prompt).toContain("(ほかに古いものが 2 本。いちばん古いのは 10-27)");
  });

  test("渡すだけのことを owner_corrections に書いても歩く約束に数えない。次の一歩に書けば数える", async () => {
    const store = freshStore();
    store.saveQuestions([
      q({
        id: "aaaa0001",
        text: "植物は音を聞き分けるか",
        theme: "植物",
        interest: 1,
        importance: 1,
        feasibility: 1,
      }),
      q({ id: "bbbb0002", text: "砂丘はなぜ歌うのか", theme: "砂" }),
      q({ id: "cccc0003", text: "潮の満ち引きで地面は動くか", theme: "潮" }),
    ]);
    // 前回の内省で、ID を書かずに「渡す」と書いた次の一歩
    store.saveWalk({ ...store.walk(), intentions: ["持ち主に答えを渡す"] });
    const prompt = await reflectOnce(store, {
      owner_corrections: ["[bbbb0002] の答えは持ち主に渡すだけでよい"],
      next_steps: ["cccc0003 を歩く"],
    });
    expect(prompt).toContain(
      "足どりとは照合できない。持ち主に渡す約束なら、渡ったかは「持ち主に渡すものの台帳」で見る",
    );
    const by = (id: string) => store.questions().find((x) => x.id === id);
    expect(by("bbbb0002")?.promised).toBeUndefined();
    expect(by("cccc0003")?.promised).toBe(1);
    expect(pendingCorrections(store.walk().ownerCorrections)[0]?.text).toBe(
      "[bbbb0002] の答えは持ち主に渡すだけでよい",
    );
  });
});

const note = (over: Partial<Note>): Note => ({
  id: "00000000",
  title: "題",
  theme: "t",
  questionId: "q",
  summary: "",
  createdAt: "",
  ...over,
});
const NOTES = [
  note({
    id: "11111111",
    title: "歩数の上限と休眠の仕組み",
    summary: "1 日の歩数の上限に当たると足が休眠させる",
  }),
  note({
    id: "22222222",
    title: "ブドウ糖と自制心の追試",
    summary: "自我消耗の追試は再現しなかった",
  }),
];
const BODIES: Record<string, string> = {
  "11111111":
    "足の記録を見て書いた。歩数の上限に当たると、次の日まで休眠する。",
  "22222222":
    "出典: https://example.org/paper\n\n追試の結果を読んだ。\n\n## 読めた深さ\n- 要旨だけ",
};
const WALKED = "私は 1 日の歩数の上限に当たると休眠する";
const READ = "自我消耗の追試が再現しなかったことを経験として知っている";
const FAR = "相手の国の料理をまだ食べたことがない";

const dialogue = (over: Partial<Dialogue>): Dialogue => ({
  at: at("2026-11-09T09:00:00"),
  model: "fake",
  field: "料理",
  turns: [
    { by: "stranger", text: "やあ" },
    { by: "ashi", text: "こんにちは" },
  ],
  added: [],
  takeaway: "t",
  ...over,
});

describe("自分について言った文に、一番近いノートを添える(P3)", () => {
  test("題と要約の文字が近いノートと、出典を読んで書いたノートかを返す", () => {
    const near = claimNotes(
      [WALKED, READ, FAR, "私は足。"],
      NOTES,
      (id) => BODIES[id],
    );
    expect(near[WALKED]?.id).toBe("11111111");
    expect(near[WALKED]?.title).toBe("歩数の上限と休眠の仕組み");
    expect(near[WALKED]?.sourced).toBe(false);
    expect(near[WALKED]?.near).toBeGreaterThanOrEqual(CLAIM_NOTE_MIN);
    expect(near[READ]?.id).toBe("22222222");
    expect(near[READ]?.sourced).toBe(true);
    // 近いノートが無い文と、短すぎて測れない文は入れない
    expect(near[FAR]).toBeUndefined();
    expect(near["私は足。"]).toBeUndefined();
    expect(claimNotes([WALKED], [], () => undefined)).toEqual({});
  });

  test("内省では文ごとに近いノートを並べ、判定は頭に任せると言う", async () => {
    const store = freshStore(["a"]);
    for (const n of NOTES) store.addNote(n, BODIES[n.id] ?? "");
    store.appendDialogue(dialogue({ aboutSelf: [WALKED, READ, FAR] }));
    const before = JSON.stringify(store.recentDialogues(1));
    const head = new FakeHead({
      explore: () => explore(),
      reflect: () => reflectAnswer(),
    });
    store.saveWalk({ ...store.walk(), steps: 4 });
    await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
    const prompt = head.calls.find((c) => c.task === "reflect")?.prompt ?? "";
    expect(prompt).toMatch(
      /- 私は 1 日の歩数の上限に当たると休眠する → \[11111111\] 歩数の上限と休眠の仕組み\(出典の記載が無いノート、近さ 0\.\d\d\)/,
    );
    expect(prompt).toMatch(
      /- 自我消耗の追試が再現しなかったことを経験として知っている → \[22222222\] ブドウ糖と自制心の追試\(外の出典を読んで書いたノート、近さ 0\.\d\d\)/,
    );
    expect(prompt).toContain(`- ${FAR} → 近いノートなし`);
    expect(prompt).toContain("足は判定しない。あなたが読み分ける");
    // 頭は足さない(歩みと内省の 2 回だけ)。会話の記録も書き換えない
    expect(head.calls.map((c) => c.task)).toEqual(["explore", "reflect"]);
    expect(JSON.stringify(store.recentDialogues(1))).toBe(before);
  });
});

describe("自分の型の言葉を、全部の返事で数える(P12)", () => {
  test("返事ごとの回数を返し、出なかった返事は入れない", () => {
    expect(
      patternsByReply(
        [
          { by: "stranger", text: "足し算の話をしよう" },
          { by: "ashi", text: "ふつうの返事です。" },
          { by: "stranger", text: "なるほど" },
          {
            by: "ashi",
            text: "それは足し算というより掛け算で、足し算ではない。",
          },
          { by: "stranger", text: "ふむ" },
          { by: "ashi", text: "寄り道でした。" },
        ],
        ["足し算", "掛け算", "寄り道", "足し算", ""],
      ),
    ).toEqual([
      {
        reply: 2,
        hits: [
          { word: "足し算", count: 2 },
          { word: "掛け算", count: 1 },
        ],
      },
      { reply: 3, hits: [{ word: "寄り道", count: 1 }] },
    ]);
    // 文字の一致だけなので、言い換えた型は拾えない
    expect(
      patternsByReply(
        [{ by: "ashi", text: "足すのではなく掛ける話" }],
        ["足し算"],
      ),
    ).toEqual([]);
  });

  const talk = (store: Store, final: string) =>
    talkWithStranger({
      store,
      head: new FakeHead({
        dialogue: () => ({ reply: "ふつうの返事です。" }),
        "dialogue-final": () => ({ reply: final, takeaway: "t" }),
      }),
      stranger: new FakeHead({ stranger: () => ({ reply: "やあ" }) }),
      turns: 2,
      now,
      rng: () => 0.99,
    });

  test("よそ者との会話に、後の返事に出た型も残す。最初の返事の欄は変えない", async () => {
    const store = freshStore();
    store.saveWalk({
      ...store.walk(),
      selfPatterns: ["足し算", "掛け算", "寄り道"],
    });
    await talk(store, "それは足し算というより掛け算で、足し算ではない。またね");
    const d = store.recentDialogues(1)[0];
    expect(d?.patternsByReply).toEqual([
      {
        reply: 2,
        hits: [
          { word: "足し算", count: 2 },
          { word: "掛け算", count: 1 },
        ],
      },
    ]);
    // patterns は今まで通り、最初の返事に出た語だけ
    expect(d?.patterns).toEqual([]);

    await talk(store, "またね");
    expect(store.recentDialogues(1)[0]?.patternsByReply).toBeUndefined();
  });

  test("内省では、一つの返事に 2 つ以上・一つの会話に 2 回以上が分かるように並べる", async () => {
    const store = freshStore(["a"]);
    store.appendDialogue(
      dialogue({
        field: "数学",
        patterns: [],
        patternsByReply: [
          {
            reply: 3,
            hits: [
              { word: "足し算", count: 2 },
              { word: "掛け算", count: 1 },
            ],
          },
        ],
      }),
    );
    const prompt = await reflectOnce(store);
    expect(prompt).toContain(
      "返事ごとに出た自分の型の言葉(文字の一致だけで、言い換えた型は拾えない): 3 番目の返事に 足し算×2・掛け算×1(一つの返事に 3 回) ── 会話全体で 3 回(一つの会話に 2 回以上)",
    );

    // 1 回だけなら括弧を付けない。この欄の無い前の会話には何も足さない
    const one = freshStore(["a"]);
    one.appendDialogue(
      dialogue({
        patternsByReply: [{ reply: 1, hits: [{ word: "寄り道", count: 1 }] }],
      }),
    );
    expect(await reflectOnce(one)).toContain(
      "1 番目の返事に 寄り道×1 ── 会話全体で 1 回\n",
    );
    const old = freshStore(["a"]);
    old.appendDialogue(dialogue({}));
    expect(await reflectOnce(old)).not.toContain(
      "返事ごとに出た自分の型の言葉",
    );
  });
});
