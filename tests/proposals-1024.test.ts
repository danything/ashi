import { expect, test } from "bun:test";
import { chat } from "../src/lib/server/ashi/legs/chat.ts";
import { blankNote, noteFindings } from "../src/lib/server/ashi/legs/guard.ts";
import { selectQuestion } from "../src/lib/server/ashi/legs/select.ts";
import { fetchUrlTool } from "../src/lib/server/ashi/legs/tools.ts";
import { step } from "../src/lib/server/ashi/legs/walk.ts";
import { correctionsBlock } from "../src/lib/server/ashi/prompts.ts";
import { explore, FakeHead, freshStore, q } from "./helpers.ts";

const now = new Date("2026-10-24T12:00:00");

test("書き損じ(埋め草・空の本文)を見分ける", () => {
  expect(blankNote({ title: "x", findings: "x" })).toBeDefined();
  expect(blankNote({ title: "(dummy)", findings: "" })).toBeDefined();
  expect(blankNote({ title: "題", findings: "短い" })).toBeDefined();
  expect(
    blankNote({
      title: "題",
      findings:
        "十分な長さの本文。調べて分かったことと、分からなかったことを書いた文章がここに続いている。",
    }),
  ).toBeUndefined();
  expect(noteFindings("# x\n\n問い: 何か\n\n\n")).toBe("");
});

test("書き損じの答えはノートにせず、問いも閉じない", async () => {
  const store = freshStore();
  const target = q({ track: "owner", promised: 2 });
  store.saveQuestions([target]);
  const head = new FakeHead({
    explore: () =>
      explore({ title: "x", summary: "x", findings: "x", answered: true }),
  });
  const o = await step({
    store,
    head,
    tools: [],
    now: () => now,
    rng: () => 0.1,
  });
  expect(o.kind).toBe("failed");
  expect(store.notes()).toHaveLength(0);
  const after = store.questions().find((x) => x.id === target.id);
  expect(after?.status).toBe("open");
  expect(after?.blankNotes).toBe(1);
  expect(after?.promised).toBeUndefined();
});

test("持ち主への借りは、日を置かず、系統もテーマの休みも待たずに先に確かめる", () => {
  const debt = q({
    track: "self",
    theme: "確かめること",
    verify: true,
    source: "chat",
    createdAt: now.toISOString(),
  });
  const own = q({ track: "owner", interest: 1, importance: 1 });
  const c = selectQuestion(
    [own, debt],
    ["確かめること", "確かめること", "確かめること"],
    {
      themeStreakLimit: 3,
      themeWindow: 10,
      themeWindowMax: 3,
      detourRate: 0,
      ownerShare: 0.5,
    },
    () => 0.1,
    now,
  );
  expect("question" in c && c.question.id).toBe(debt.id);
  expect("question" in c && c.reason).toBe("verify");
});

test("確かめた答えの渡し待ちは、話題に関係なく渡すよう見せる", () => {
  const text = correctionsBlock(
    [{ id: "a1", text: "合っていた", at: "", kind: "answer" }],
    "relevant",
  );
  expect(text).toContain("まだ渡していない答え");
  expect(text).toContain("話題に関係なく");
  expect(text).not.toContain("伝えていない訂正");
});

test("返事が空なら道具を外して一度だけ作り直し、それでも空なら作れなかったと返す", async () => {
  const store = freshStore();
  let n = 0;
  const head = new FakeHead({
    chat: () => ({ reply: n++ === 0 ? "" : "調べたら、こうだった。" }),
  });
  const r = await chat(
    { store, head, tools: [], now: () => now },
    "p",
    [],
    "今調べて回答して",
  );
  expect(r.reply).toBe("調べたら、こうだった。");
  expect(head.calls).toHaveLength(2);
  expect(head.calls[1]?.tools).toEqual([]);

  const empty = new FakeHead({ chat: () => ({ reply: "" }) });
  const r2 = await chat(
    { store, head: empty, tools: [], now: () => now },
    "p",
    [],
    "え",
  );
  expect(r2.reply).toContain("返事を作れなかった");
});

test("401・403 は弾かれたことに積まず、別の道を示す", async () => {
  const blocked: string[] = [];
  const denied: string[] = [];
  const out = await fetchUrlTool(
    { fetch: { maxBytes: 10_000, timeoutMs: 1000 } },
    {
      fetch: (async () =>
        new Response("no", {
          status: 403,
          headers: { "content-type": "text/html" },
        })) as unknown as typeof fetch,
      resolve: async () => ["93.184.216.34"],
    },
    {
      blocked: (h) => blocked.push(h),
      ok: () => {},
      denied: (h) => denied.push(h),
    },
  ).run({ url: "https://www.sciencedirect.com/science/article/pii/1" });
  expect(out).toContain("archived_copy");
  expect(blocked).toEqual([]);
  expect(denied).toEqual(["www.sciencedirect.com"]);
});
