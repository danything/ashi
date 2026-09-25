import { fail } from "@sveltejs/kit";
import { system } from "$lib/server/ashi/prompts";
import { hashText } from "$lib/server/ashi/state";
import { md } from "$lib/server/markdown";
import { isStepping, resetLearning, store } from "$lib/server/runtime";
import { ownerView } from "$lib/server/views";
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
};
