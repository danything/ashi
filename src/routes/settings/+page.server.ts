import { fail } from "@sveltejs/kit";
import {
	applySettingsForm,
	FEED_KINDS,
	MODELS,
	normalizeConfig,
} from "#lib/server/ashi/config.ts";
import { localDay } from "#lib/server/ashi/state.ts";
import { saveConfig, store } from "#lib/server/runtime.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	const cfg = store.config();
	const b = store.budget(localDay(new Date()));
	return {
		cfg,
		json: JSON.stringify(cfg, null, 2),
		models: [...MODELS] as string[],
		feedKinds: FEED_KINDS,
		/** 置き場所の環境変数(秘密は名前だけ。設定はここには無い) */
		secrets: {
			ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
			CLAUDE_CODE_OAUTH_TOKEN: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
			X_BEARER_TOKEN: Boolean(process.env.X_BEARER_TOKEN),
			GITHUB_TOKEN: Boolean(process.env.GITHUB_TOKEN),
			FORGEJO_TOKEN: Boolean(process.env.FORGEJO_TOKEN),
		},
		legacyEnv: ["ASHI_CONFIG", "ASHI_FEEDS"].filter((k) =>
			process.env[k]?.trim(),
		),
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
		saveConfig(
			applySettingsForm(store.config(), await request.formData()),
			locals.user?.name ?? "?",
		);
		return { saved: true };
	},
	/** 全項目を JSON で書く(画面に欄の無い項目も変えられる) */
	saveJson: async ({ request, locals }) => {
		const text = String((await request.formData()).get("json") ?? "");
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch (e) {
			return fail(400, {
				jsonError: `JSON として読めない: ${e instanceof Error ? e.message : String(e)}`,
				json: text,
			});
		}
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			return fail(400, { jsonError: "オブジェクトで書く", json: text });
		saveConfig(normalizeConfig(raw), locals.user?.name ?? "?");
		return { saved: true };
	},
};
