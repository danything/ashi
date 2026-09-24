/**
 * 足の設定(状態ディレクトリの ashi.json)。書くのは人だけで、頭からは触れない。
 * 読み込むときに範囲へ丸めるので、ここに無茶な値を書いてもガードレールは外れない。
 */

/**
 * 持ち主の足跡。rss: フィードの URL / github: ユーザー名 / x: ユーザー名(X_BEARER_TOKEN が要る)/
 * forgejo: ユーザー名(FORGEJO_URL と FORGEJO_TOKEN が要る。非公開リポジトリの動きも読む)
 */
export interface Feed {
	id: string;
	kind: "rss" | "github" | "x" | "forgejo";
	target: string;
	title?: string;
}

export interface Config {
	/** 頭に使うモデル */
	model: string;
	effort: "low" | "medium" | "high" | "xhigh" | "max";
	budget: {
		/** 1 日(ローカル時刻の 0 時区切り)に使ってよい額(ドル) */
		dailyUsd: number;
		/** 1 歩で使ってよい額(ドル) */
		stepUsd: number;
	};
	sleep: {
		/** 1 歩ごとの休みの下限と上限(分)。頭の希望はこの範囲に丸める */
		minMinutes: number;
		maxMinutes: number;
	};
	/** 同じテーマを続けて歩いてよい歩数 */
	themeStreakLimit: number;
	/** 点数の順ではなく、でたらめに問いを選ぶ(寄り道する)確率 */
	detourRate: number;
	/**
	 * 先回り(持ち主が知らなそうだが、いつか聞きそうなこと)を歩く割合。残りは個性(持ち主の地図に無い方向)。
	 * どちらを歩くかは足がさいころで決める
	 */
	ownerShare: number;
	/** 持ち主の材料が増えていたら、何歩ごとに持ち主の地図を書き直すか */
	profileEvery: number;
	/** 何歩ごとに内省(日記と自己記述)するか */
	reflectEvery: number;
	/** 持ち主の足跡。いつ読むかは頭が決める */
	feeds: Feed[];
	/** 同じ足跡を読みに行く間隔の下限(時間) */
	feedMinHours: number;
	/** 1 歩で増やしてよい問いの数 */
	maxNewQuestions: number;
	/** 開いたまま抱えておける問いの数。超えたら点の低いものから手放す */
	maxOpenQuestions: number;
	/** 1 歩で道具を使う往復の上限 */
	maxToolRounds: number;
	/** 頭の側の web 検索を使うか */
	allowWeb: boolean;
	fetch: {
		/** fetch_url で読む本文の上限(バイト) */
		maxBytes: number;
		timeoutMs: number;
	};
}

export const DEFAULT_CONFIG: Config = {
	model: "claude-opus-5-5",
	effort: "high",
	budget: { dailyUsd: 2, stepUsd: 0.5 },
	sleep: { minMinutes: 10, maxMinutes: 360 },
	themeStreakLimit: 3,
	detourRate: 0.15,
	ownerShare: 0.6,
	profileEvery: 10,
	reflectEvery: 5,
	feeds: [],
	feedMinHours: 6,
	maxNewQuestions: 3,
	maxOpenQuestions: 50,
	maxToolRounds: 8,
	allowWeb: true,
	fetch: { maxBytes: 200_000, timeoutMs: 15_000 },
};

const clamp = (
	v: unknown,
	min: number,
	max: number,
	fallback: number,
): number =>
	typeof v === "number" && Number.isFinite(v)
		? Math.min(max, Math.max(min, v))
		: fallback;

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** ashi.json の中身(一部だけでもよい)を既定で埋め、範囲に丸める */
export function normalizeConfig(raw: unknown): Config {
	const r = (raw ?? {}) as Partial<Record<keyof Config, unknown>> & {
		budget?: Partial<Config["budget"]>;
		sleep?: Partial<Config["sleep"]>;
		fetch?: Partial<Config["fetch"]>;
	};
	const d = DEFAULT_CONFIG;
	const minMinutes = clamp(r.sleep?.minMinutes, 1, 24 * 60, d.sleep.minMinutes);
	const dailyUsd = clamp(r.budget?.dailyUsd, 0, 1000, d.budget.dailyUsd);
	return {
		model: typeof r.model === "string" && r.model ? r.model : d.model,
		effort: EFFORTS.includes(r.effort as Config["effort"])
			? (r.effort as Config["effort"])
			: d.effort,
		budget: {
			dailyUsd,
			// 1 歩の上限が 1 日の上限を超えることはない
			stepUsd: clamp(
				r.budget?.stepUsd,
				0,
				dailyUsd,
				Math.min(d.budget.stepUsd, dailyUsd),
			),
		},
		sleep: {
			minMinutes,
			maxMinutes: clamp(
				r.sleep?.maxMinutes,
				minMinutes,
				7 * 24 * 60,
				Math.max(minMinutes, d.sleep.maxMinutes),
			),
		},
		themeStreakLimit: Math.round(
			clamp(r.themeStreakLimit, 1, 100, d.themeStreakLimit),
		),
		detourRate: clamp(r.detourRate, 0, 1, d.detourRate),
		ownerShare: clamp(r.ownerShare, 0, 1, d.ownerShare),
		profileEvery: Math.round(clamp(r.profileEvery, 1, 1000, d.profileEvery)),
		reflectEvery: Math.round(clamp(r.reflectEvery, 1, 1000, d.reflectEvery)),
		feeds: normalizeFeeds(r.feeds),
		feedMinHours: clamp(r.feedMinHours, 1, 24 * 30, d.feedMinHours),
		maxNewQuestions: Math.round(
			clamp(r.maxNewQuestions, 0, 20, d.maxNewQuestions),
		),
		maxOpenQuestions: Math.round(
			clamp(r.maxOpenQuestions, 1, 1000, d.maxOpenQuestions),
		),
		maxToolRounds: Math.round(clamp(r.maxToolRounds, 0, 50, d.maxToolRounds)),
		allowWeb: typeof r.allowWeb === "boolean" ? r.allowWeb : d.allowWeb,
		fetch: {
			maxBytes: Math.round(
				clamp(r.fetch?.maxBytes, 1_000, 5_000_000, d.fetch.maxBytes),
			),
			timeoutMs: Math.round(
				clamp(r.fetch?.timeoutMs, 1_000, 120_000, d.fetch.timeoutMs),
			),
		},
	};
}

const FEED_KINDS = ["rss", "github", "x", "forgejo"] as const;

function normalizeFeeds(raw: unknown): Feed[] {
	if (!Array.isArray(raw)) return [];
	const out: Feed[] = [];
	for (const f of raw as Partial<Feed>[]) {
		if (
			!FEED_KINDS.includes(f?.kind as Feed["kind"]) ||
			typeof f.target !== "string" ||
			!f.target
		)
			continue;
		const id =
			typeof f.id === "string" && f.id ? f.id : `${f.kind}:${f.target}`;
		if (out.some((x) => x.id === id)) continue;
		out.push({
			id,
			kind: f.kind as Feed["kind"],
			target: f.target,
			title: typeof f.title === "string" ? f.title : undefined,
		});
	}
	return out;
}
