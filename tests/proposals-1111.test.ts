import { describe, expect, test } from "bun:test";

import {
  addOwnerCorrections,
  CLOSE_HINT_MIN,
  CLOSE_HINTS_MAX,
  closeHints,
  CORRECTIONS_PER_REPLY,
  groupCorrections,
  missedPromises,
  type OwnerCorrection,
  pendingCorrections,
  replyAt,
  shownCloseHints,
} from "../src/lib/server/ashi/legs/guard.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
import { REFLECT_SCHEMA } from "../src/lib/server/ashi/prompts.ts";
import type { Note, Store } from "../src/lib/server/ashi/state.ts";
import { explore, FakeHead, freshStore, q } from "./helpers.ts";

// Ashi の改善案 2 件(2026-11-11): 訂正を返事ごとに束ねて見せる・ノートが別の開いた問いに答えていたら知らせる

const now = new Date("2026-11-11T12:00:00");
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
  withdrawn_corrections: [],
  ...over,
});

/** 1 歩歩いて内省まで進め、内省に渡したプロンプトを返す */
async function reflectOnce(
  store: Store,
  over: Record<string, unknown> = {},
  walked: Record<string, unknown> = {},
): Promise<string> {
  const w = store.walk();
  store.saveWalk({
    ...w,
    steps: w.lastReflectStep + 4,
    sleepingUntil: undefined,
  });
  const head = new FakeHead({
    profile: () => ({ owner: "# 持ち主の興味の地図", new_questions: [] }),
    explore: () => explore(walked),
    reflect: () => reflectAnswer(over),
  });
  await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
  const prompt = head.calls.find((c) => c.task === "reflect")?.prompt;
  expect(prompt).toBeDefined();
  return prompt ?? "";
}

const ADVICE = at("2026-10-24T21:15:00");
const OTHER = at("2026-10-20T08:30:00");
const chatEntry = (when: string, question: string) => ({
  at: when,
  by: "持ち主",
  question,
  reply: "返事",
  usd: 0,
});

/** 同じ助言への訂正の言い換え(指す返事の欄が無い、前の形の台帳) */
const PILE = [
  "#45799 の助言で、納期の交渉は先に価格を固めるべきと言ったが、根拠にした調査は別の業種のものだった",
  "#45799 の助言の根拠にした調査は別の業種のもので、納期の交渉は先に価格を固めるべきとは言えなかった",
  "納期の交渉は先に価格を固めるべきという #45799 の助言は、別の業種の調査を根拠にしていた",
  "#45799 の助言で根拠にした調査は別の業種のものだった。納期の交渉で先に価格を固めるべきとまでは言えない",
  "#45799 の助言(納期の交渉は先に価格を固めるべき)は、根拠の調査が別の業種のものだったので弱い",
  "別の業種の調査を根拠に、#45799 で納期の交渉は先に価格を固めるべきと助言していた",
];
const pile = (): OwnerCorrection[] =>
  PILE.map((text, i) => ({
    id: `f${i + 1}`,
    text,
    at: at(`2026-10-${25 + i}T09:00:00`),
  }));
const STRAY: OwnerCorrection = {
  id: "s1",
  text: "関税の税率の表は 2024 年版を見ていた",
  at: at("2026-10-22T09:00:00"),
};

describe("渡していない訂正を、指している持ち主への返事ごとに束ねて見せる(62a79425)", () => {
  test("答えの形: owner_corrections は文と、指す返事の日時", () => {
    const item = (
      REFLECT_SCHEMA.properties as Record<
        string,
        { items?: { properties: object; required: string[] } }
      >
    ).owner_corrections?.items;
    expect(Object.keys(item?.properties ?? {}).sort()).toEqual(
      [...(item?.required ?? [])].sort(),
    );
    expect(item?.required).toEqual(["text", "reply_at"]);
  });

  test("頭が書いた日時を、分まで合う返事に引き当てる。合わなければ付けない", () => {
    const chats = [{ at: ADVICE }, { at: OTHER }];
    expect(replyAt("2026-10-24 21:15", chats)).toBe(ADVICE);
    expect(replyAt("10-24 21:15 の返事", chats)).toBe(ADVICE);
    expect(replyAt("2026-10-20 8:30", chats)).toBe(OTHER);
    // 年が違う・分が違う・日付だけ・形が違うものは、当て推量で寄せない
    expect(replyAt("2025-10-24 21:15", chats)).toBeUndefined();
    expect(replyAt("2026-10-24 21:16", chats)).toBeUndefined();
    expect(replyAt("2026-10-24", chats)).toBeUndefined();
    expect(replyAt("", chats)).toBeUndefined();
    expect(replyAt(undefined, chats)).toBeUndefined();
  });

  test("台帳に足すとき、指す返事を持たせる。文だけの前の形も受け取る", () => {
    const chats = [{ at: ADVICE }];
    const out = addOwnerCorrections(
      undefined,
      [
        { text: "価格の話は根拠が弱かった", reply_at: "2026-10-24 21:15" },
        { text: "在庫の数え方を言い間違えた", reply_at: "2026-01-01 00:00" },
        "季節の波の話は渡すだけ",
        { text: "  ", reply_at: "2026-10-24 21:15" },
        { reply_at: "2026-10-24 21:15" },
      ],
      now,
      undefined,
      undefined,
      { chats },
    );
    expect(out.map((c) => [c.text, c.chatAt])).toEqual([
      ["価格の話は根拠が弱かった", ADVICE],
      ["在庫の数え方を言い間違えた", undefined],
      ["季節の波の話は渡すだけ", undefined],
    ]);
    // 足が確かめた訂正は、問いが生まれた返事の時刻をそのまま持つ
    const verified = addOwnerCorrections(
      out,
      "数字が外れていた",
      now,
      "q1",
      undefined,
      {
        chatAt: OTHER,
      },
    );
    expect(verified.at(-1)).toMatchObject({ questionId: "q1", chatAt: OTHER });
  });

  test("ほぼ同じ文は重ねない。指す返事が分かっていなかった内省の訂正なら、欄だけ埋める", () => {
    const prev: OwnerCorrection[] = [
      { id: "f1", text: PILE[0] ?? "", at: at("2026-10-25T09:00:00") },
      {
        id: "v1",
        text: "時差の数字は足が確かめて外れていた",
        at: at("2026-10-26T09:00:00"),
        questionId: "q1",
      },
    ];
    const out = addOwnerCorrections(
      prev,
      [
        { text: `${PILE[0]}。`, reply_at: "2026-10-24 21:15" },
        {
          text: "時差の数字は足が確かめて外れていた。",
          reply_at: "2026-10-24 21:15",
        },
      ],
      now,
      undefined,
      undefined,
      { chats: [{ at: ADVICE }] },
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ ...prev[0], chatAt: ADVICE } as OwnerCorrection);
    // 足が確かめたものには、頭の申告で欄を付けない
    expect(out[1]).toEqual(prev[1] as OwnerCorrection);
  });

  test("束ね方: 欄・問いの出どころ・文字の近さの順。足が確かめたものしか無い組は促さない", () => {
    const debt = q({ id: "q1", source: "chat", createdAt: ADVICE });
    const ledger: OwnerCorrection[] = [
      STRAY,
      {
        id: "a1",
        text: PILE[0] ?? "",
        at: at("2026-10-25T09:00:00"),
        chatAt: ADVICE,
      },
      // 欄は無いが、足が確かめた訂正。問いが生まれた返事から引く
      {
        id: "v1",
        text: "粗利の数字は足が確かめて外れていた",
        at: at("2026-10-26T09:00:00"),
        questionId: "q1",
      },
      // 欄も問いも無い古い項目。文字の近い組に寄せ、寄せたと分かる印を付ける
      { id: "g1", text: PILE[1] ?? "", at: at("2026-10-27T09:00:00") },
      {
        id: "o1",
        text: "送料の話は渡すだけ",
        at: at("2026-10-28T09:00:00"),
        chatAt: OTHER,
      },
    ];
    const groups = groupCorrections(
      ledger,
      [
        chatEntry(ADVICE, "#45799 の納期はどう交渉する?"),
        chatEntry(OTHER, "送料は?"),
      ],
      [debt],
    );
    expect(
      groups.map((g) => [g.chatAt, g.items.map((c) => c.id), g.crowded]),
    ).toEqual([
      [undefined, ["s1"], false],
      [ADVICE, ["a1", "v1", "g1"], false],
      [OTHER, ["o1"], false],
    ]);
    expect(groups[1]?.question).toBe("#45799 の納期はどう交渉する?");
    expect(groups[1]?.items.map((c) => c.guessed)).toEqual([
      undefined,
      undefined,
      true,
    ]);

    // 3 本を超えても、頭が取り下げられるものが 2 本無ければ、まとめ直しようがない
    const verifiedOnly: OwnerCorrection[] = [1, 2, 3, 4].map((i) => ({
      id: `v${i}`,
      text: `確かめた訂正その ${i}`,
      at: at(`2026-10-2${i}T09:00:00`),
      questionId: "q1",
    }));
    expect(groupCorrections(verifiedOnly, [], [debt])[0]).toMatchObject({
      chatAt: ADVICE,
      crowded: false,
    });
    expect(CORRECTIONS_PER_REPLY).toBe(3);
  });

  test("本番の形(欄の無い 6 本の言い換え): 文字の近さで 1 組に寄せ、3 本を超えたと数える", () => {
    const groups = groupCorrections([STRAY, ...pile()], [], []);
    expect(groups.map((g) => g.items.map((c) => c.id))).toEqual([
      ["s1"],
      ["f1", "f2", "f3", "f4", "f5", "f6"],
    ]);
    expect(groups.map((g) => g.crowded)).toEqual([false, true]);
    // 3 本ちょうどは促さない
    expect(
      groupCorrections(pile().slice(0, 3), [], []).map((g) => g.crowded),
    ).toEqual([false]);
  });

  test("内省では束ねて並べ、まとめ直しを促す。足は自分ではまとめ直さない", async () => {
    const store = freshStore(["a"]);
    store.appendChat(chatEntry(ADVICE, "#45799 の納期はどう交渉する?"));
    store.saveWalk({ ...store.walk(), ownerCorrections: [STRAY, ...pile()] });
    const prompt = await reflectOnce(store);
    expect(prompt).toContain("まだ渡していないもの(7 本。");
    expect(prompt).toContain("▼ 指す返事の記録が無いが、文字の近いもの 6 本");
    expect(prompt).toContain("→ ここに 6 本ある(3 本を超えた)");
    expect(prompt).toContain("足はまとめ直さない");
    expect(prompt).toContain("▼ 指す返事の記録が無いもの 1 本");
    expect(prompt).toContain(`[s1] ${STRAY.text}`);
    // 頭が何も書かなければ、台帳はそのまま
    expect(store.walk().ownerCorrections?.map((c) => c.id)).toEqual([
      "s1",
      "f1",
      "f2",
      "f3",
      "f4",
      "f5",
      "f6",
    ]);
  });

  test("頭がまとめ直すと、取り下げた分が外れ、まとめた 1 本が指す返事を持つ。次の内省ではその返事の下に並ぶ", async () => {
    const store = freshStore(["a", "b"]);
    store.appendChat(chatEntry(ADVICE, "#45799 の納期はどう交渉する?"));
    store.saveWalk({ ...store.walk(), ownerCorrections: [STRAY, ...pile()] });
    await reflectOnce(store, {
      withdrawn_corrections: ["f1", "f2", "f3", "f4", "f5", "f6"],
      owner_corrections: [
        {
          text: "#45799 の助言(納期の交渉は先に価格を固める)は、根拠の調査が別の業種のものだった",
          reply_at: "2026-10-24 21:15",
        },
      ],
    });
    const pending = pendingCorrections(store.walk().ownerCorrections);
    expect(pending.map((c) => c.id).slice(0, 1)).toEqual(["s1"]);
    expect(pending).toHaveLength(2);
    expect(pending[1]?.chatAt).toBe(ADVICE);

    const next = await reflectOnce(store);
    expect(next).toContain(
      "▼ 2026-10-24 21:15 の持ち主への返事について 1 本(持ち主: #45799 の納期はどう交渉する?)",
    );
    expect(next).not.toContain("→ ここに");
  });

  test("足が確かめた訂正は、問いが生まれた返事を指す。束が 3 本を超えても、足が確かめた分は取り下げられない", async () => {
    const store = freshStore(["a"]);
    store.appendChat(chatEntry(ADVICE, "#45799 の納期はどう交渉する?"));
    const debt = q({
      id: "d0000001",
      text: "持ち主に「業界の平均の納期は 30 日」と言った。合っているか",
      theme: "確かめること",
      verify: true,
      source: "chat",
      createdAt: ADVICE,
    });
    // 持ち主への借りは、ほかの問いより先に歩く
    store.saveQuestions([...store.questions(), debt]);
    store.saveWalk({
      ...store.walk(),
      ownerCorrections: pile()
        .slice(0, 3)
        .map((c) => ({ ...c, chatAt: ADVICE })),
    });
    const prompt = await reflectOnce(
      store,
      { withdrawn_corrections: ["f1", "f2", "f3", "zzzz"] },
      {
        correction: "業界の平均の納期は 30 日ではなく 45 日だった",
        answered: true,
      },
    );
    const ledger = store.walk().ownerCorrections ?? [];
    const verified = ledger.find((c) => c.questionId === debt.id);
    expect(verified?.chatAt).toBe(ADVICE);
    expect(prompt).toContain(
      "▼ 2026-10-24 21:15 の持ち主への返事について 4 本",
    );
    expect(prompt).toContain(`[${verified?.id}] (足が確かめた訂正)`);
    expect(prompt).toContain("→ ここに 4 本ある(3 本を超えた)");
    expect(prompt).toContain("reply_at は 2026-10-24 21:15");
    // 内省が自分で書いた 3 本は外れ、足が確かめた 1 本は残る
    expect(ledger.map((c) => c.id)).toEqual([verified?.id ?? ""]);
    await reflectOnce(store, { withdrawn_corrections: [verified?.id] });
    expect(store.walk().ownerCorrections?.map((c) => c.id)).toEqual([
      verified?.id ?? "",
    ]);
  });
});

// 作った例。本番の 6be30c48(Richardson 2010 を読んだノート)と 93d33daa の中身は手元に無い
const RICHARDSON: Note = {
  id: "6be30c48",
  title: "Richardson 2010: 作業記憶の負荷と遅延割引",
  theme: "遅延割引",
  questionId: "aaaa0001",
  summary:
    "Richardson (2010) は、作業記憶に負荷をかけると遅延割引が急になると報告した。参加者は大学生 48 人で、効果量は中程度だった。",
  createdAt: at("2026-11-10T10:00:00"),
};
const BODY =
  "# Richardson 2010\n問い: 作業記憶と遅延割引の関係\n\n方法の節まで読めた。参加者は 48 人。https://example.org/richardson2010";
const body = (id: string) => (id === RICHARDSON.id ? BODY : undefined);

const before = at("2026-11-01T00:00:00");
const ANSWERED = q({
  id: "93d33daa",
  text: "Richardson 2010 の遅延割引の実験は、参加者が何人で効果量はどのくらいだったか",
  createdAt: before,
});
const LONG = q({
  id: "bbbb0001",
  text: "遅延割引の研究でよく引かれる Richardson (2010) は、作業記憶の負荷で割引が急になると言っているらしいが、実際には何人の参加者で、どのくらいの効果量だったのか。追試はあるのか",
  createdAt: before,
});
const SAME_TOPIC = q({
  id: "bbbb0002",
  text: "遅延割引の割引率は年齢によって変わるか",
  createdAt: before,
});
const FAR = q({
  id: "bbbb0003",
  text: "江戸時代の囲碁の家元は、どうやって収入を得ていたか",
  createdAt: before,
});
const SOURCE = q({
  id: "aaaa0001",
  text: "作業記憶に負荷をかけると、遅延割引は急になるのか",
  createdAt: before,
});

describe("ノートが別の開いた問いに答えていそうなら、内省で知らせる(38a38fd2)", () => {
  test("問いの文字がノートの題と要約に出ていれば候補にする。元の問い・遠い問いは並べない", () => {
    const hints = closeHints(
      [RICHARDSON],
      [SOURCE, ANSWERED, LONG, SAME_TOPIC, FAR],
      body,
    );
    expect(hints.map((h) => h.question.id)).toEqual(["93d33daa", "bbbb0001"]);
    expect(hints[0]).toMatchObject({
      note: { id: "6be30c48", title: RICHARDSON.title },
      by: "text",
    });
    for (const h of hints)
      expect(h.near).toBeGreaterThanOrEqual(CLOSE_HINT_MIN);
    // 長い言い方の問いは近さが下がる(0.5 だと落ちる)。取りこぼさない側に線を引いた
    expect(hints[1]?.near).toBeLessThan(0.6);
    expect(CLOSE_HINT_MIN).toBe(0.4);
  });

  test("問いの ID がノートの本文に出ていれば、文字が遠くても候補にして先に並べる", () => {
    const withId = (id: string) =>
      id === RICHARDSON.id
        ? `${BODY}\n\nついでに [bbbb0003] の家元の収入の話も、この論文の脚注に出ていた。`
        : undefined;
    const hints = closeHints([RICHARDSON], [ANSWERED, FAR], withId);
    expect(hints.map((h) => [h.question.id, h.by])).toEqual([
      ["bbbb0003", "id"],
      ["93d33daa", "text"],
    ]);
    expect(hints[0]?.excerpt).toContain("[bbbb0003] の家元の収入");
    // 別の ID の一部として出てきただけなら拾わない
    const partial = (id: string) =>
      id === RICHARDSON.id
        ? "この数字は 0bbbb0003f という版の表から"
        : undefined;
    expect(closeHints([RICHARDSON], [FAR], partial)).toEqual([]);
  });

  test("束ね直しただけのノート・閉じた問い・ノートより後に生まれた問い・前回の内省より前のノートは外す", () => {
    expect(
      closeHints([{ ...RICHARDSON, incomplete: true }], [ANSWERED], body),
    ).toEqual([]);
    expect(
      closeHints([RICHARDSON], [{ ...ANSWERED, status: "answered" }], body),
    ).toEqual([]);
    // そのノートから出た問い(同じ時刻)は、文字が近くて当たり前
    expect(
      closeHints(
        [RICHARDSON],
        [{ ...ANSWERED, createdAt: RICHARDSON.createdAt }],
        body,
      ),
    ).toEqual([]);
    expect(
      closeHints([RICHARDSON], [ANSWERED], body, at("2026-11-10T11:00:00")),
    ).toEqual([]);
    expect(
      closeHints([RICHARDSON], [ANSWERED], body, at("2026-11-10T09:00:00")),
    ).toHaveLength(1);
  });

  test("内省に並べるのはノート 1 本につき 3 本、全部で 8 本まで", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...ANSWERED,
      id: `cccc000${i}`,
    }));
    const one = closeHints([RICHARDSON], many, body);
    expect(one).toHaveLength(5);
    expect(shownCloseHints(one)).toHaveLength(3);
    const notes = Array.from({ length: 4 }, (_, i) => ({
      ...RICHARDSON,
      id: `dddd000${i}`,
      title: `${RICHARDSON.title} その ${i}`,
    }));
    const wide = notes.flatMap((n) =>
      one.slice(0, 3).map((h, j) => ({
        ...h,
        note: { id: n.id, title: n.title },
        question: { ...h.question, id: `${n.id}-${j}` },
      })),
    );
    expect(shownCloseHints(wide)).toHaveLength(CLOSE_HINTS_MAX);
  });

  test("歩かれなかった問いの理由に、閉じる候補のノートを添える", () => {
    const qs = [SOURCE, ANSWERED, SAME_TOPIC];
    const hints = closeHints([RICHARDSON], qs, body);
    const [hit, miss] = missedPromises(
      ["93d33daa", "bbbb0002"],
      qs,
      [],
      [],
      hints,
    );
    expect(hit?.why).toContain("開いたまま選ばれなかった");
    expect(hit?.why).toContain(
      "別の問いを歩いたノート [6be30c48]「Richardson 2010: 作業記憶の負荷と遅延割引」が閉じる候補",
    );
    expect(hit?.why).toContain("close_by_note");
    expect(miss?.why).toContain("開いたまま選ばれなかった");
    expect(miss?.why).not.toContain("閉じる候補");
  });

  test("内省に並べるだけで、足は閉じない。頭が close_by_note に書けば閉じる", async () => {
    const store = freshStore(["a"]);
    store.saveQuestions([
      ...store.questions(),
      { ...SOURCE, status: "answered" },
      ANSWERED,
      FAR,
    ]);
    store.addNote(RICHARDSON, BODY);
    const prompt = await reflectOnce(store);
    expect(prompt).toContain("閉じる候補(前回の内省の後に書いたノートが");
    expect(prompt).toContain("精度は分からず");
    expect(prompt).toMatch(
      /- ノート \[6be30c48\] Richardson 2010: 作業記憶の負荷と遅延割引 → 問い \[93d33daa\] .*(文字の近さ 0\.\d\d)/,
    );
    expect(prompt).not.toContain("→ 問い [bbbb0003]");
    const open = (id: string) =>
      store.questions().find((x) => x.id === id)?.status;
    expect(open("93d33daa")).toBe("open");

    // 前回の内省より前のノートになったので、もう並べない。閉じるのは頭の申告だけ
    const next = await reflectOnce(store, {
      close_by_note: [{ question_id: "93d33daa", note_id: "6be30c48" }],
    });
    expect(next).not.toContain("閉じる候補(");
    expect(open("93d33daa")).toBe("answered");
    expect(store.questions().find((x) => x.id === "93d33daa")?.answeredBy).toBe(
      "6be30c48",
    );
  });

  test("候補が無ければ、内省に節を出さない。頭も余分に呼ばない", async () => {
    const store = freshStore(["a"]);
    store.saveQuestions([...store.questions(), FAR]);
    store.addNote(RICHARDSON, BODY);
    const w = store.walk();
    store.saveWalk({ ...w, steps: w.lastReflectStep + 4 });
    const head = new FakeHead({
      explore: () => explore(),
      reflect: () => reflectAnswer(),
    });
    await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
    expect(head.calls.map((c) => c.task)).toEqual(["explore", "reflect"]);
    expect(head.calls[1]?.prompt).not.toContain("閉じる候補(");
  });
});
