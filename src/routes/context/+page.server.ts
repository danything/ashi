import { fail } from "@sveltejs/kit";

import { markDelivered } from "#lib/server/ashi/legs/guard.ts";
import { system } from "#lib/server/ashi/prompts.ts";
import { hashText } from "#lib/server/ashi/state.ts";
import { md } from "#lib/server/markdown.ts";
import { isStepping, resetLearning, store } from "#lib/server/runtime.ts";
import { ownerView } from "#lib/server/views.ts";

import type { Actions, PageServerLoad } from "./$types";

/** 頭が毎回受け取っているもの。コア原則・自己記述・持ち主の地図と、それを束ねた system */
export const load: PageServerLoad = () => {
  const core = store.core();
  return {
    core: md(core),
    coreOk: hashText(core) === store.walk().coreHash,
    self: md(store.self()),
    system: system(core, store.self(), store.owner()),
    config: JSON.stringify(store.config(), null, 2),
    intentions: store.walk().intentions ?? [],
    // 渡した印の付いたものは出さない(次の内省で一度見せてから落とす)
    corrections: (store.walk().ownerCorrections ?? []).filter(
      (c) => !c.deliveredAt,
    ),
    bridges: store.bridgeIdeas().slice().reverse(),
    stranger: store.config().stranger,
    dialogues: store.recentDialogues(5),
    stepping: isStepping(),
    // 持ち主の地図を並べる(フォームは /owner の actions)
    owner: ownerView(),
    counts: {
      questions: store.questions().length,
      notes: store.notes().length,
      steps: store.walk().steps,
    },
  };
};

export const actions: Actions = {
  /** 学びを白紙に戻す。打ち間違いで押さないよう「リセット」と打たせる */
  reset: async ({ request }) => {
    const f = await request.formData();
    if (String(f.get("confirm") ?? "").trim() !== "リセット") {
      return fail(400, {
        resetMessage: "確かめの欄に「リセット」と入れてください",
      });
    }
    const r = resetLearning();
    if (!r.ok) return fail(409, { resetMessage: r.message });
    return { archive: r.archive };
  },
  /**
   * 並んでいる訂正を、持ち主が読んだ。渡した印を付ける(話して渡したのと区別する)。印を付けるのは
   * 画面に出ていた ID だけ(読み込んだ後に積まれたものは残す)
   */
  read: async ({ request }) => {
    const ids = (await request.formData()).getAll("id").map(String);
    const w = store.walk();
    const told = markDelivered(w.ownerCorrections, ids, new Date(), "read");
    if (told.delivered.length) {
      store.saveWalk({ ...w, ownerCorrections: told.ledger });
      store.log("corrections-read", { delivered: told.delivered });
    }
    return { read: told.delivered.length };
  },
};
