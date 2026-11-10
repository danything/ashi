import { describe, expect, test } from "bun:test";

import {
  groupMates,
  retractionPairs,
  sameClaim,
} from "../src/lib/server/ashi/legs/guard.ts";
import { talkWithStranger } from "../src/lib/server/ashi/legs/stranger.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
import {
  explorePrompt,
  reflectPrompt,
  type ReflectTalk,
  type WalkContext,
} from "../src/lib/server/ashi/prompts.ts";
import type { Dialogue, Store } from "../src/lib/server/ashi/state.ts";
import { explore, FakeHead, freshStore, q } from "./helpers.ts";

const now = new Date("2026-11-10T03:00:00Z");

/** 締めの答えの、空の欄 */
const final = (over: Record<string, unknown> = {}) => ({
  reply: "またね",
  new_questions: [],
  takeaway: "t",
  unverified: [],
  accepted: [],
  about_self: [],
  pushed_back: [],
  retracted: [],
  spot_check: "",
  ...over,
});

/** よそ者と 2 往復話す。rng が 0 なら、さいころの文も選ぶ */
const talk = (
  store: Store,
  closing: Record<string, unknown>,
  opts: { said?: string; rng?: () => number } = {},
) =>
  talkWithStranger({
    store,
    head: new FakeHead({
      dialogue: () => ({ reply: opts.said ?? "なるほど。" }),
      "dialogue-final": () => final(closing),
    }),
    stranger: new FakeHead({ stranger: () => ({ reply: "話をしよう" }) }),
    turns: 2,
    now,
    rng: opts.rng ?? (() => 0.99),
  });

const ctx: WalkContext = {
  notes: [],
  questions: [],
  feeds: "",
  intentions: [],
  bridges: [],
  recentThemes: [],
  resting: [],
};

describe("解釈の言い方の引っ込めは確かめの問いにしない(P9)", () => {
  // 10-29 の囲碁や将棋の会話で、確かめの問い d935dfea になった引っ込め
  const view = {
    mine: "後から探す言葉は、正解を持ち運ぶための圧縮である。",
    because: "言葉は後から来て、次の読みを変える探索の道具になる。",
    backing: "なし" as const,
  };

  test("checkable が false なら問いにせず、会話の記録には残す", async () => {
    const store = freshStore();
    const { dialogue } = await talk(store, {
      retracted: [{ ...view, checkable: false }],
    });
    expect(store.questions().filter((x) => x.verify)).toHaveLength(0);
    expect(dialogue.retracted).toEqual([{ ...view, checkable: false }]);
    expect(store.recentDialogues(1)[0]?.retracted?.[0]?.checkable).toBe(false);
  });

  test("checkable が true・無い・真偽値でないときは、これまで通り両方を問いにする", async () => {
    for (const checkable of [true, undefined, "いいえ"]) {
      const store = freshStore();
      const { dialogue } = await talk(store, {
        retracted: [
          {
            mine: "近くの側の測定値は割れている",
            because: "Freedman らの値は誤差を入れると 67 とも 73 とも重なる",
            backing: "出典",
            ...(checkable === undefined ? {} : { checkable }),
          },
        ],
      });
      expect(
        store.questions().filter((x) => x.verifyKind === "retract"),
      ).toHaveLength(2);
      // 問いにしたものには印を残さない(古い行と同じ形)
      expect(dialogue.retracted?.[0]).not.toHaveProperty("checkable");
    }
  });

  test("内省では、問いにしなかった引っ込めに「見方」と付けて見せる", () => {
    const d: Dialogue = {
      at: now.toISOString(),
      model: "fake",
      field: "囲碁や将棋",
      turns: [],
      added: [],
      takeaway: "",
      retracted: [
        { ...view, checkable: false },
        { mine: "石の数は 361 個", because: "盤の交点が 361", backing: "出典" },
      ],
    };
    const text = reflectPrompt([], "", [], [], [], undefined, undefined, {
      dialogues: [d],
      chats: [],
      stances: [],
      landing: { home: 0, own: 0, total: 0 },
    } as unknown as ReflectTalk);
    expect(text).toContain(
      "「後から探す言葉は、正解を持ち運ぶための圧縮である。」← 「言葉は後から来て、次の読みを変える探索の道具になる。」(相手が添えていたもの: なし)(見方。記録だけ)",
    );
    expect(text).toContain(
      "「石の数は 361 個」← 「盤の交点が 361」(相手が添えていたもの: 出典)",
    );
    expect(text).not.toContain("出典)(見方");
  });
});

describe("言ったことと、さいころの言い切りの重複(P10)", () => {
  // 10-27 の海洋の会話(77df8fdd と 35fc9464)に近い形
  const said =
    "ワニトカゲギスの仲間は赤い光を出し、ほかの深海魚には見えない波長で獲物を照らす";
  const spot =
    "ワニトカゲギスの仲間は、ほかの深海魚には見えない赤い光で獲物を照らしている";

  test("片方がもう片方にほぼ含まれる主張は同じ、同じ話題の別の主張は別", () => {
    expect(sameClaim(said, spot)).toBe(true);
    expect(sameClaim(spot, said)).toBe(true);
    expect(sameClaim(said, "赤い光は水深 10 m ほどでほとんど吸収される")).toBe(
      false,
    );
    expect(
      sameClaim(said, "深海魚の多くは青い光しか見えない目を持っている"),
    ).toBe(false);
    // 短すぎる文は比べない
    expect(sameClaim("赤い光", "赤い光は水深 10 m で消える")).toBe(false);
  });

  test("さいころの事実が言ったことと同じなら積まず、落としたことを会話の記録に残す", async () => {
    const store = freshStore();
    const { dialogue } = await talk(
      store,
      { unverified: [said], spot_check: spot },
      { said: `${spot}。`, rng: () => 0 },
    );
    const checks = store.questions().filter((x) => x.verify);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.text).toContain(said);
    expect(checks[0]?.verifyKind).toBeUndefined();
    expect(dialogue.spot).toEqual({
      sentence: `${spot}。`,
      claim: spot,
      duplicate: said,
    });
    expect(store.recentLog(1)[0]).toMatchObject({
      event: "stranger",
      spotDuplicate: said,
    });
  });

  test("別の事実なら、さいころの問いも積む", async () => {
    const store = freshStore();
    const other = "赤い光は水深 10 m ほどでほとんど吸収される";
    const { dialogue } = await talk(
      store,
      { unverified: [said], spot_check: other },
      { said: `${other}という話です。`, rng: () => 0 },
    );
    expect(
      store.questions().filter((x) => x.verifyKind === "spot"),
    ).toHaveLength(1);
    expect(store.questions().filter((x) => x.verify)).toHaveLength(2);
    expect(dialogue.spot?.duplicate).toBeUndefined();
  });

  test("締めの頼みに、ほかの欄に書いた事実なら spot_check は空と書く", async () => {
    const store = freshStore();
    const head = new FakeHead({
      dialogue: () => ({ reply: `${spot}。` }),
      "dialogue-final": () => final(),
    });
    await talkWithStranger({
      store,
      head,
      stranger: new FakeHead({ stranger: () => ({ reply: "やあ" }) }),
      turns: 2,
      now,
      rng: () => 0,
    });
    expect(head.calls.at(-1)?.prompt).toContain(
      "同じ事実を unverified・pushed_back・retracted に書いたなら、spot_check は空にしてください",
    );
  });
});

describe("言ったことと、それを引っ込めたことを組にする(P5)", () => {
  // 11-06 の地質学の会話で、別々の借りになった 2 本(045fefea と 8844c661)
  const claim =
    "ジルコン中では Li と Ti はどちらも拡散しやすい(乱れやすい)元素である。";
  const back =
    "それから、さっき Li と Ti を同じ「乱れやすい」側に並べたのは、記憶で言った雑な並べ方でした。";

  test("前の発言を取り消す文と、語の重なる元の主張を組にする", () => {
    expect(retractionPairs([claim, back])).toEqual([[back, claim]]);
    // 取り消しの文が、いちばん語の重なる主張と組になる
    expect(
      retractionPairs([
        "石英の中では酸素の拡散は遅い。",
        back,
        claim,
        "ジルコンは風化に強い鉱物である。",
      ]),
    ).toEqual([[back, claim]]);
  });

  test("語の重なりが少ない文・前の発言を指さない文は組にしない", () => {
    expect(
      retractionPairs([
        claim,
        "さっきの海流の話は、記憶で言ったので自信がありません。",
      ]),
    ).toEqual([]);
    expect(
      retractionPairs([
        claim,
        "ジルコンの Li と Ti の濃度は、マグマの温度の目安になる。",
      ]),
    ).toEqual([]);
  });

  test("会話から出た 2 本の問いに、互いの ID を持たせて一緒に歩かせる", async () => {
    const store = freshStore();
    // 取り消しの文は締めの発言にあり、足が「記憶で言」の印で拾う
    await talk(store, { reply: `${back}またね。`, unverified: [claim] });
    const checks = store.questions().filter((x) => x.verify);
    expect(checks).toHaveLength(2);
    const a = checks.find((x) => x.text.startsWith(`「${claim}」`));
    const b = checks.find((x) => x.text.startsWith(`「${back}」`));
    expect(a?.pairOf).toBe(b?.id);
    expect(b?.pairOf).toBe(a?.id);
    if (!a || !b) throw new Error("問いが無い");
    expect(groupMates(a, [], store.questions()).map((x) => x.id)).toEqual([
      b.id,
    ]);
    expect(
      groupMates(b, undefined, store.questions()).map((x) => x.id),
    ).toEqual([a.id]);
  });

  test("引っ込めた主張と、きっかけの相手の主張も組にする", async () => {
    const store = freshStore();
    await talk(store, {
      retracted: [
        {
          mine: "近くの側の測定値は割れている",
          because: "Freedman らの値は誤差を入れると 67 とも 73 とも重なる",
          backing: "出典",
          checkable: true,
        },
      ],
    });
    const [mine, because] = store
      .questions()
      .filter((x) => x.verifyKind === "retract");
    expect(mine?.pairOf).toBe(because?.id);
    expect(because?.pairOf).toBe(mine?.id);
  });

  test("引っ込めた主張と同じ主張が言ったことにもあれば、引っ込めた側の 1 本にする", async () => {
    const store = freshStore();
    await talk(store, {
      unverified: [
        "近くの側の測定値は割れていると言った",
        "遠くの側の値は 67 で揃っている",
      ],
      retracted: [
        {
          mine: "近くの側の測定値は割れている",
          because: "Freedman らの値は誤差を入れると 67 とも 73 とも重なる",
          backing: "なし",
          checkable: true,
        },
      ],
    });
    const checks = store.questions().filter((x) => x.verify);
    expect(checks).toHaveLength(3);
    expect(checks.filter((x) => x.text.startsWith("「近くの側"))).toHaveLength(
      1,
    );
    expect(
      checks.find((x) => x.text.startsWith("「近くの側"))?.verifyKind,
    ).toBe("retract");
  });

  test("組の相手は、どちらの向きからも出る。閉じた相手は出ない", () => {
    const a = q({ id: "a1", verify: true });
    const b = q({ id: "b1", verify: true, pairOf: "a1" });
    const c = q({ id: "c1", verify: true, pairOf: "a1", status: "answered" });
    expect(groupMates(a, undefined, [a, b, c]).map((x) => x.id)).toEqual([
      "b1",
    ]);
    expect(groupMates(b, undefined, [a, b, c]).map((x) => x.id)).toEqual([
      "a1",
    ]);
    // 内省の組とも合わせる
    const d = q({ id: "d1" });
    expect(
      groupMates(a, [["a1", "d1"]], [a, b, c, d])
        .map((x) => x.id)
        .sort(),
    ).toEqual(["b1", "d1"]);
  });
});

describe("持ち主に言ったことの確かめには、返事の全文を渡す(P13)", () => {
  const at = (h: number) =>
    `2026-10-24T${String(h).padStart(2, "0")}:39:00.000Z`;
  const entry = (h: number, reply: string) => ({
    at: at(h),
    by: "p",
    question: `問い ${h}`,
    reply,
    usd: 0.01,
  });
  // 内省で見える 500 字より長い返事。訂正は末尾にある
  const long = `${"前置きの文。".repeat(120)}svelte-check の条件とパーサ同梱の訂正を、ここで伝えた。`;
  // 持ち主との対話は材料として数えるので、歩く前に地図を書き直す頼みが来る
  const walker = () =>
    new FakeHead({
      profile: () => ({ owner: "持ち主の地図", new_questions: [] }),
      explore: () => explore(),
    });

  test("問いが生まれた返事を先に取り、残りを後の返事の新しいほうから、3 通まで古い順に", () => {
    const store = freshStore();
    for (const h of [1, 2, 3, 4, 5, 6]) store.appendChat(entry(h, `返事 ${h}`));
    expect(store.chatsAround([at(2)], 3).map((c) => c.reply)).toEqual([
      "返事 2",
      "返事 5",
      "返事 6",
    ]);
    // 束ねた問いの元の返事も先に取る
    expect(store.chatsAround([at(2), at(3)], 3).map((c) => c.reply)).toEqual([
      "返事 2",
      "返事 3",
      "返事 6",
    ]);
    // 後の返事が無ければ元の返事だけ。持ち主への借りが無ければ何も読まない
    expect(store.chatsAround([at(6)], 3).map((c) => c.reply)).toEqual([
      "返事 6",
    ]);
    expect(store.chatsAround([], 3)).toEqual([]);
  });

  test("歩く頭に、元の返事とそれより後の返事を全文で渡す。自己記述は今まで通り渡す", async () => {
    const store = freshStore();
    store.saveSelf("直しはまだ持ち主に渡していない。");
    store.appendChat(entry(9, "古い返事。"));
    store.appendChat(
      entry(10, "svelte-check はパーサを同梱している(記憶で)。"),
    );
    store.appendChat(entry(16, long));
    const debt = q({
      id: "deb70001",
      text: "「svelte-check はパーサを同梱している」は本当か(持ち主に言ったこと)",
      theme: "確かめること",
      verify: true,
      source: "chat",
      createdAt: at(10),
    });
    store.saveQuestions([debt]);
    const head = walker();
    await step({ store, head, tools: [], now: () => now, rng: () => 0.9 });
    const call = head.calls.find((c) => c.task === "explore");
    expect(call?.prompt).toContain(
      "この返事の全文だけで決めてください。自己記述の「まだ渡していない」「伝えた」のような行では決めないこと",
    );
    expect(call?.prompt).toContain("(問い deb70001 が生まれた返事)");
    // 500 字で切らず、末尾の訂正まで渡す
    expect(call?.prompt).toContain(
      "svelte-check の条件とパーサ同梱の訂正を、ここで伝えた。",
    );
    // 問いより前の返事は渡さない
    expect(call?.prompt).not.toContain("古い返事。");
    // 対照にはしない
    expect(call?.system).toContain("直しはまだ持ち主に渡していない。");
  });

  test("持ち主への借りでなければ、返事は渡さない", async () => {
    const store = freshStore();
    store.appendChat(entry(10, "持ち主への返事。"));
    store.saveQuestions([
      q({ id: "feed0001", verify: true, source: "stranger", via: "fake:海洋" }),
    ]);
    const head = walker();
    await step({ store, head, tools: [], now: () => now, rng: () => 0.9 });
    const call = head.calls.find((c) => c.task === "explore");
    expect(call?.prompt).not.toContain("持ち主への返事。");
    expect(call?.prompt).not.toContain("この返事の全文だけで決めて");
  });

  test("束ねて歩く相手が持ち主への借りなら、その問いの ID を添えて返事を渡す", () => {
    const main = q({ id: "aaaa0001", verify: true, source: "stranger" });
    const mate = q({
      id: "bbbb0002",
      verify: true,
      source: "chat",
      createdAt: at(10),
    });
    const text = explorePrompt(
      main,
      "score",
      ctx,
      [mate],
      [],
      [entry(10, "返事の本文。"), entry(12, "後の返事。")],
    );
    expect(text).toContain("持ち主に言ったことの確かめの問い(bbbb0002)なので");
    expect(text).toContain("(問い bbbb0002 が生まれた返事)\n持ち主: 問い 10");
    expect(text).toContain("あなた: 後の返事。");
    // 1 通は 4000 字まで
    const cut = explorePrompt(
      mate,
      "verify",
      ctx,
      [],
      [],
      [entry(10, "長".repeat(5000))],
    );
    expect(cut).toContain(`${"長".repeat(4000)}…`);
    expect(cut).not.toContain("長".repeat(4001));
  });
});
