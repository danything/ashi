import { acceptSettings, MODELS } from "#lib/server/ashi/config.ts";
import { localDay } from "#lib/server/ashi/state.ts";
import { saveSettings, store } from "#lib/server/runtime.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	const cfg = store.config();
	const b = store.budget(localDay(new Date()));
	return {
		cfg: {
			head: cfg.head,
			model: cfg.model,
			effort: cfg.effort,
			maxStepsPerDay: cfg.maxStepsPerDay,
			maxToolRounds: cfg.maxToolRounds,
			stranger: cfg.stranger.enabled,
			strangerModel: cfg.stranger.model,
			x: cfg.x.enabled,
		},
		overridden: Object.keys(store.settings()).length > 0,
		models: [...MODELS] as string[],
		today: {
			steps: b.steps ?? 0,
			inputTokens: b.inputTokens,
			outputTokens: b.outputTokens,
		},
		history: store.budgetHistory().slice(-7).reverse(),
	};
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		saveSettings(
			acceptSettings(await request.formData()),
			locals.user?.name ?? "?",
		);
		return { saved: true };
	},
	/** 画面で変えた値を消し、デプロイの設定(ASHI_CONFIG)に戻す */
	reset: ({ locals }) => {
		saveSettings(undefined, locals.user?.name ?? "?");
		return { reset: true };
	},
};
