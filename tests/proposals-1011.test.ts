import { describe, expect, test } from "bun:test";

import { relatedOpen } from "../src/lib/server/ashi/legs/guard.ts";
import { byRank, selectQuestion } from "../src/lib/server/ashi/legs/select.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
import { explore, FakeHead, freshStore, q } from "./helpers.ts";

const now = new Date("2026-10-11T03:00:00Z");

describe("同点なら次の一歩に書いた問いを先に", () => {
  test("0.01 刻みで同じ点数なら promised の問いを上に、差があれば点数の順", () => {
    const a = q({ id: "a", interest: 0.8, importance: 0.8, feasibility: 0.8 });
    const b = q({
      id: "b",
      interest: 0.8,
      importance: 0.8,
      feasibility: 0.8,
      promised: 1,
    });
    expect([a, b].sort(byRank).map((x) => x.id)).toEqual(["b", "a"]);
    const c = q({ id: "c", interest: 1, importance: 1, feasibility: 1 });
    expect([b, c].sort(byRank).map((x) => x.id)).toEqual(["c", "b"]);
    const pick = selectQuestion(
      [a, b],
      [],
      {
        themeStreakLimit: 3,
        themeWindow: 10,
        themeWindowMax: 3,
        detourRate: 0,
        ownerShare: 0,
      },
      () => 0.9,
      now,
    );
    expect("question" in pick ? pick.question.id : "").toBe("b");
  });
});

describe("確かめの問いと近い問い", () => {
  test("確かめの問いに文字の近い、開いた確かめでない問いを近い順に 2 本まで", () => {
    const v = q({
      id: "v",
      verify: true,
      text: "「ゼンメルワイスの二つの病棟の死亡率」は本当か",
    });
    const qs = [
      v,
      q({
        id: "r1",
        text: "ゼンメルワイスの二つの病棟の死亡率の差はどこから来たか",
      }),
      q({ id: "r2", text: "まったく関係のない天気の問い" }),
      q({
        id: "r3",
        text: "ゼンメルワイスの病棟の死亡率",
        status: "answered",
      }),
      q({ id: "r4", text: "二つの病棟の死亡率は本当か", verify: true }),
    ];
    expect(relatedOpen(v, qs).map((x) => x.id)).toEqual(["r1"]);
    expect(relatedOpen(qs[1] as never, qs)).toEqual([]);
  });

  test("確かめの問いを歩いて、添えた近い問いにこのノートで答えが出たら閉じる", async () => {
    const store = freshStore();
    store.saveQuestions([
      q({
        id: "aaaaaaa1",
        track: "self",
        verify: true,
        text: "「ゼンメルワイスの二つの病棟の死亡率」は本当か",
        createdAt: "2026-10-01T00:00:00Z",
      }),
      q({
        id: "aaaaaaa2",
        track: "owner",
        text: "ゼンメルワイスの二つの病棟の死亡率の差はどこから来たか",
      }),
    ]);
    const head = new FakeHead({
      explore: (req) => {
        expect(req.prompt).toContain("- aaaaaaa2: ゼンメルワイス");
        return explore({ also_answered: ["aaaaaaa2", "zzzzzzzz"] });
      },
    });
    await step({ store, head, tools: [], now: () => now, rng: () => 0.99 });
    const closed = store.questions().find((x) => x.id === "aaaaaaa2");
    expect(closed?.status).toBe("answered");
    expect(closed?.answeredBy).toBe(store.notes()[0]?.id);
  });
});
