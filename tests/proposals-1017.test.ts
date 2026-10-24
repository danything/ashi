import { describe, expect, test } from "bun:test";

import { unsettledConflicts } from "../src/lib/server/ashi/legs/citations.ts";
import {
  acceptGroups,
  applyReestimates,
  debtLedger,
  groupMates,
  missedPromises,
} from "../src/lib/server/ashi/legs/guard.ts";
import { talkWithStranger } from "../src/lib/server/ashi/legs/stranger.ts";
import {
  carriedPhrases,
  countStyle,
} from "../src/lib/server/ashi/legs/style.ts";
import { mainVerifyResult } from "../src/lib/server/ashi/legs/walk.ts";
import { openList } from "../src/lib/server/ashi/prompts.ts";
import { FakeHead, freshStore, q } from "./helpers.ts";

const now = new Date("2026-10-17T03:00:00Z");

describe("歩かれなかった理由に、代わりに選ばれたものと決め手", () => {
  const missed = q({ id: "m1", track: "self", theme: "植物", promised: 1 });
  test("同じ系統で選ばれた問いと理由、テーマを休ませていた歩みの数を書く", () => {
    const [r] = missedPromises(
      ["m1"],
      [missed],
      [],
      [
        {
          questionId: "v1",
          track: "self",
          reason: "verify",
          resting: ["植物"],
        },
        { questionId: "o1", track: "owner", reason: "score" },
      ],
    );
    expect(r?.why).toContain(
      "個性の系統は 1 歩で、選ばれたのは [v1] 確かめの先回し",
    );
    expect(r?.why).toContain("1 歩はテーマ「植物」を休ませていた");
  });
  test("その系統がさいころで出なかったなら、そう書く", () => {
    const [r] = missedPromises(
      ["m1"],
      [missed],
      [],
      [{ questionId: "o1", track: "owner", reason: "score" }],
    );
    expect(r?.why).toContain("系統のさいころで個性が出なかった");
  });
});

test("閉じた借りと、歩いた開いた問いに答えのノートを添える", () => {
  const notes = [
    {
      id: "n1",
      title: "揺らす刺激",
      theme: "t",
      questionId: "d1",
      summary: "",
      createdAt: "2026-10-10T00:00:00Z",
    },
    {
      id: "n2",
      title: "見つからなかった",
      theme: "t",
      questionId: "o1",
      summary: "",
      createdAt: "2026-10-11T00:00:00Z",
    },
  ];
  const d = debtLedger(
    [
      q({
        id: "d1",
        verify: true,
        status: "answered",
        lastVisitedAt: "2026-10-16T00:00:00Z",
      }),
    ],
    now,
    14,
    notes,
  );
  expect(d.notes.d1?.id).toBe("n1");
  const list = openList(
    [q({ id: "o1", visits: 1 }), q({ id: "o2" })],
    undefined,
    d.notes,
  );
  expect(list).toContain(
    "[o1] [self] 問い(歩いた 1 回、ノート [n2] 見つからなかった)",
  );
  expect(list).not.toContain("[o2] [self] 問い(");
});

test("一緒に歩く組は開いた問いだけの 2〜4 本、組の相手を引く", () => {
  const qs = [
    q({ id: "a" }),
    q({ id: "b" }),
    q({ id: "c", status: "answered" }),
    q({ id: "d" }),
  ];
  const groups = acceptGroups(
    [{ ids: ["a", "b", "c", "a"] }, { ids: ["d"] }, { ids: "x" }],
    qs,
  );
  expect(groups).toEqual([["a", "b"]]);
  expect(groupMates(qs[0] as never, groups, qs).map((x) => x.id)).toEqual([
    "b",
  ]);
});

test("見立ての付け直しは開いた問いだけ、0〜1 に丸め、回数を数える", () => {
  const r = applyReestimates(
    [q({ id: "a", feasibility: 0.35 }), q({ id: "b", status: "answered" })],
    [
      {
        question_id: "a",
        interest: 0.7,
        importance: 0.8,
        feasibility: 1.4,
        why: "ノートで読めた",
      },
      { question_id: "b", interest: 1, importance: 1, feasibility: 1, why: "" },
    ],
  );
  expect(r.questions[0]).toMatchObject({ feasibility: 1, reestimated: 1 });
  expect(r.changed.map((c) => c.id)).toEqual(["a"]);
});

test("食い違いの決着は一覧から外す", () => {
  const c = {
    authors: "Santoro・Broockman",
    kind: "year" as const,
    variants: [],
  };
  expect(
    unsettledConflicts([c], [], {
      "year:Santoro・Broockman": { verdict: "別の論文" },
    }),
  ).toEqual([]);
});

test("確かめの問いの結果を、checked・訂正・答え・見つからなかったから決める", () => {
  const v = q({ id: "v", verify: true });
  expect(
    mainVerifyResult(v, {
      checked: [{ id: "v", result: "wrong" }],
      correction: "",
      answered: true,
      found: "yes",
    }),
  ).toBe("wrong");
  expect(
    mainVerifyResult(v, {
      checked: [],
      correction: "違った",
      answered: true,
      found: "yes",
    }),
  ).toBe("wrong");
  expect(
    mainVerifyResult(v, {
      checked: [],
      correction: "",
      answered: true,
      found: "yes",
    }),
  ).toBe("holds");
  expect(
    mainVerifyResult(v, {
      checked: [],
      correction: "",
      answered: false,
      found: "none",
    }),
  ).toBe("unreadable");
});

test("相手の言葉で引っ込めた主張と、きっかけの相手の主張を両方確かめの問いにする", async () => {
  const store = freshStore();
  await talkWithStranger({
    store,
    head: new FakeHead({
      dialogue: () => ({ reply: "近くの側は割れています。" }),
      "dialogue-final": () => ({
        reply: "そこは引っ込めます。またね",
        new_questions: [],
        takeaway: "t",
        unverified: [],
        accepted: [],
        about_self: [],
        pushed_back: [],
        retracted: [
          {
            mine: "近くの側の測定値は割れている",
            because: "Freedman らの値は誤差を入れると 67 とも 73 とも重なる",
            backing: "なし",
          },
        ],
        spot_check: "",
      }),
    }),
    stranger: new FakeHead({
      stranger: () => ({ reply: "宇宙の膨張の話をしよう" }),
    }),
    turns: 2,
    now,
    rng: () => 0.99,
  });
  const checks = store.questions().filter((x) => x.verifyKind === "retract");
  expect(checks).toHaveLength(2);
  expect(checks.some((x) => x.text.includes("Freedman"))).toBe(true);
  expect(store.recentDialogues(1)[0]?.retracted).toHaveLength(1);
  // 相手が何を添えていたかも残す(合わせただけかを後で数える)
  expect(store.recentDialogues(1)[0]?.retracted?.[0]?.backing).toBe("なし");
});

test("直前 2 回の会話の分野は、次のさいころで選ばない", async () => {
  const store = freshStore();
  const talk = () =>
    talkWithStranger({
      store,
      head: new FakeHead({
        dialogue: () => ({ reply: "なるほど" }),
        "dialogue-final": () => ({ reply: "またね", takeaway: "t" }),
      }),
      stranger: new FakeHead({ stranger: () => ({ reply: "やあ" }) }),
      turns: 1,
      now,
      // いつも先頭の分野を引くさいころ
      rng: () => 0,
    });
  const fields = [];
  for (let i = 0; i < 4; i++) fields.push((await talk()).dialogue.field);
  expect(fields[0]).not.toBe(fields[1]);
  expect(fields[1]).not.toBe(fields[2]);
  expect(fields[0]).not.toBe(fields[2]);
  // 2 回休んだ分野はまた選べる
  expect(fields[3]).toBe(fields[0]);
});

test("返事に、前の文章と同じ文字の並び(漢字・カタカナを含む 8 字)が出たら拾う", () => {
  const r = carriedPhrases(
    ["今日も足し算というより掛け算だと思う。", "ふつうの返事です。"],
    [
      { label: "医学史の会話", text: "それは足し算というより掛け算の話です。" },
      { label: "自己記述", text: "と思います。と思います。" },
    ],
  );
  expect(r).toEqual([
    { reply: 1, phrase: "足し算というより", from: "医学史の会話" },
  ]);
});

test("話し方の物差しに、文と段落の長さのばらつきと読点の率", () => {
  const s = countStyle(
    "短い。とても長い文がここにあります、読点も、あります。\n\n次の段落。",
    [],
  );
  expect(s.sentenceCv).toBeGreaterThan(0.3);
  expect(s.paragraphCv).toBeGreaterThan(0.3);
  expect(s.commaRate).toBeGreaterThan(0);
  expect(countStyle("同じ。同じ。", []).sentenceCv).toBe(0);
});
