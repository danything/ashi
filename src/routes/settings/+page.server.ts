import { fail } from "@sveltejs/kit";
import {
	applySettingsForm,
	FEED_KINDS,
	MODELS,
	normalizeConfig,
} from "#lib/server/ashi/config.ts";
import {
	type PhraseEntry,
	phraseLedger,
	styleComparison,
} from "#lib/server/ashi/legs/style.ts";
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
		phrases: phraseLedger(store),
		// 話し方を直す前と後で、返事 1 通あたりの癖の数を比べる(Ashi の改善案、2026-10-10)
		style: styleComparison(
			store.recentChats(2000),
			phraseLedger(store).map((p) => p.text),
		),
	};
};

export const actions: Actions = {
	/** 言い回しの台帳を 1 行 1 つで書き直す。前からある行は、いつ・誰が足したかを残す */
	savePhrases: async ({ request, locals }) => {
		const text = String((await request.formData()).get("phrases") ?? "");
		const prev = new Map(phraseLedger(store).map((p) => [p.text, p]));
		const now = new Date().toISOString();
		const seen = new Set<string>();
		const entries: PhraseEntry[] = [];
		// 1 行に 1 つ。「語句 / 訳調」「語句 / 口ぐせ」で札を付けられる
		for (const line of text.split(/\r?\n/)) {
			const [head, tail] = line.split(/\s*\/\s*/);
			const t = (head ?? "").trim().slice(0, 40);
			if (t.length < 2 || seen.has(t)) continue;
			seen.add(t);
			const kind =
				tail?.trim() === "訳調" || tail?.trim() === "口ぐせ"
					? (tail.trim() as PhraseEntry["kind"])
					: undefined;
			const base = prev.get(t) ?? { text: t, from: "edit" as const, at: now };
			const { kind: _, ...rest } = base;
			entries.push(kind ? { ...rest, kind } : rest);
		}
		const lines = entries.slice(0, 100);
		store.savePhrases(lines);
		store.log("phrases", { by: locals.user?.name ?? "?", count: lines.length });
		return { phrasesSaved: true };
	},
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
