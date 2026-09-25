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
	/**
	 * 頭の繋ぎ方。api: Messages API を API キーで(従量課金)/
	 * claude-code: Claude Code の CLI をサブスクのトークンで(head/claude-code.ts)
	 */
	head: "api" | "claude-code";
	/** 頭に使うモデル */
	model: string;
	effort: "low" | "medium" | "high" | "xhigh" | "max";
	/** 1 日(ローカル時刻の 0 時区切り)に歩いてよい歩数。サブスクはドルで測れないので、これで止める */
	maxStepsPerDay: number;
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
	/**
	 * 直近 themeWindow 歩のうち、同じテーマが themeWindowMax 回に達したら選ばない。
	 * 連続の上限だけだと、別の系統が間に挟まると交互に同じテーマを歩き続けた(Ashi の改善案、2026-09-25)
	 */
	themeWindow: number;
	themeWindowMax: number;
	/** 同じ問いで何も見つからなかった回数がこれに達したら、未測定の棚に移して選ばない */
	missesToPark: number;
	/** 1 つのテーマで抱えてよい開いた問いの数。超えたら新しい問いを受け取らない(テーマに寄りすぎないように) */
	maxOpenPerTheme: number;
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
	/**
	 * Ashi の X アカウント。投稿も返信も頭が決め、足は数と額の上限で止める。
	 * X の API は従量課金(読み 1 件 0.005・投稿 1 件 0.015 ドル、2026-09)
	 */
	x: {
		enabled: boolean;
		dailyUsd: number;
		maxPostsPerDay: number;
		maxRepliesPerDay: number;
		/** メンションを読みに行く間隔の下限(分) */
		mentionsEveryMinutes: number;
	};
	/**
	 * よそ者との対話。内省のたびに、持ち主の地図を知らない別のモデルと短く話し、個性の問いの種にする。
	 * 個性の問いが全部持ち主の関心から派生していた(2026-09-25、ownerPull 24 / 24)ので、外の関心を持ち込む
	 */
	stranger: {
		enabled: boolean;
		/** 相手のモデル。頭(Opus)と癖が違えばよく、賢さは要らない */
		model: string;
		/** 往復の数(相手 → Ashi で 1 往復) */
		turns: number;
	};
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
	head: "api",
	model: "claude-opus-5-5",
	maxStepsPerDay: 30,
	effort: "high",
	budget: { dailyUsd: 2, stepUsd: 0.5 },
	sleep: { minMinutes: 10, maxMinutes: 360 },
	themeStreakLimit: 3,
	themeWindow: 10,
	themeWindowMax: 3,
	missesToPark: 2,
	maxOpenPerTheme: 6,
	detourRate: 0.15,
	ownerShare: 0.6,
	profileEvery: 10,
	reflectEvery: 5,
	feeds: [],
	feedMinHours: 6,
	x: {
		enabled: false,
		dailyUsd: 1,
		maxPostsPerDay: 3,
		maxRepliesPerDay: 10,
		mentionsEveryMinutes: 60,
	},
	stranger: { enabled: true, model: "claude-sonnet-5", turns: 3 },
	maxNewQuestions: 3,
	maxOpenQuestions: 50,
	maxToolRounds: 12,
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
		x?: Partial<Config["x"]>;
		stranger?: Partial<Config["stranger"]>;
	};
	const d = DEFAULT_CONFIG;
	const minMinutes = clamp(r.sleep?.minMinutes, 1, 24 * 60, d.sleep.minMinutes);
	const dailyUsd = clamp(r.budget?.dailyUsd, 0, 1000, d.budget.dailyUsd);
	return {
		head: r.head === "claude-code" ? "claude-code" : "api",
		model: typeof r.model === "string" && r.model ? r.model : d.model,
		maxStepsPerDay: Math.round(
			clamp(r.maxStepsPerDay, 1, 1000, d.maxStepsPerDay),
		),
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
		themeWindow: Math.round(clamp(r.themeWindow, 1, 100, d.themeWindow)),
		themeWindowMax: Math.round(
			clamp(r.themeWindowMax, 1, 100, d.themeWindowMax),
		),
		missesToPark: Math.round(clamp(r.missesToPark, 1, 100, d.missesToPark)),
		maxOpenPerTheme: Math.round(
			clamp(r.maxOpenPerTheme, 1, 100, d.maxOpenPerTheme),
		),
		themeStreakLimit: Math.round(
			clamp(r.themeStreakLimit, 1, 100, d.themeStreakLimit),
		),
		detourRate: clamp(r.detourRate, 0, 1, d.detourRate),
		ownerShare: clamp(r.ownerShare, 0, 1, d.ownerShare),
		profileEvery: Math.round(clamp(r.profileEvery, 1, 1000, d.profileEvery)),
		reflectEvery: Math.round(clamp(r.reflectEvery, 1, 1000, d.reflectEvery)),
		feeds: normalizeFeeds(r.feeds),
		feedMinHours: clamp(r.feedMinHours, 1, 24 * 30, d.feedMinHours),
		x: {
			enabled: typeof r.x?.enabled === "boolean" ? r.x.enabled : d.x.enabled,
			dailyUsd: clamp(r.x?.dailyUsd, 0, 100, d.x.dailyUsd),
			maxPostsPerDay: Math.round(
				clamp(r.x?.maxPostsPerDay, 0, 50, d.x.maxPostsPerDay),
			),
			maxRepliesPerDay: Math.round(
				clamp(r.x?.maxRepliesPerDay, 0, 100, d.x.maxRepliesPerDay),
			),
			mentionsEveryMinutes: Math.round(
				clamp(r.x?.mentionsEveryMinutes, 5, 24 * 60, d.x.mentionsEveryMinutes),
			),
		},
		stranger: {
			enabled:
				typeof r.stranger?.enabled === "boolean"
					? r.stranger.enabled
					: d.stranger.enabled,
			model:
				typeof r.stranger?.model === "string" &&
				/^claude-[a-z0-9.-]+$/.test(r.stranger.model)
					? r.stranger.model
					: d.stranger.model,
			turns: Math.round(clamp(r.stranger?.turns, 1, 6, d.stranger.turns)),
		},
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
