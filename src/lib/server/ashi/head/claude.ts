import Anthropic from "@anthropic-ai/sdk";
import {
	addUsage,
	type Blockage,
	type Head,
	HeadAccessError,
	HeadError,
	noUsage,
	type ThinkRequest,
	type ThinkResult,
	type Usage,
} from "./head.ts";

/** 1M トークンあたりのドル(入力, 出力)。キャッシュの読みは入力の 0.1 倍、書きは 1.25 倍 */
const PRICES: Record<string, [number, number]> = {
	"claude-fable-5-1": [10, 50],
	"claude-fable-5": [10, 50],
	"claude-opus-5-5": [4, 20],
	"claude-opus-5": [5, 25],
	"claude-opus-4-8": [5, 25],
	"claude-sonnet-5": [2, 10],
	"claude-haiku-4-5": [1, 5],
};
/** web 検索は 1,000 回で 10 ドル */
const WEB_SEARCH_USD = 0.01;

/** 拒否されたら分類に合わせて別のモデルで答え直させる(サーバー側)。Opus 5 の既定の作法 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** サーバー側の道具(web 検索)が途中で止まったときに続けさせる回数の上限 */
const MAX_CONTINUATIONS = 5;

export interface ClaudeHeadOptions {
	model?: string;
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	client?: Anthropic;
}

/** 頭の既定。Claude の Messages API を道具の往復込みで 1 回の think にまとめる */
export class ClaudeHead implements Head {
	readonly name: string;
	private readonly client: Anthropic;
	private readonly effort: NonNullable<ClaudeHeadOptions["effort"]>;

	constructor(opts: ClaudeHeadOptions = {}) {
		this.name = opts.model ?? "claude-opus-5";
		this.effort = opts.effort ?? "high";
		// 鍵は ANTHROPIC_API_KEY か `ant auth login` のプロファイルから SDK が拾う
		this.client = opts.client ?? new Anthropic();
	}

	async think<T>(req: ThinkRequest): Promise<ThinkResult<T>> {
		const tools = req.tools ?? [];
		const byName = new Map(tools.map((t) => [t.name, t]));
		const apiTools: Anthropic.Beta.BetaToolUnion[] = tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
			strict: true,
		}));
		if (req.allowWeb) {
			apiTools.push({
				type: "web_search_20260209",
				name: "web_search",
				max_uses: 5,
			});
		}

		const messages: Anthropic.Beta.BetaMessageParam[] = [
			...(req.history ?? []).map((t) => ({ role: t.role, content: t.text })),
			{ role: "user", content: req.prompt },
		];
		let usage = noUsage();
		let rounds = 0;
		let continuations = 0;

		while (true) {
			// 往復か額の上限に来たら道具を取り上げ、ここまでで答えさせる
			const tired =
				rounds >= (req.maxToolRounds ?? 8) ||
				(req.maxCostUsd !== undefined && usage.costUsd >= req.maxCostUsd);
			const res = await this.create(usage, {
				model: this.name,
				max_tokens: 16000,
				betas: [FALLBACK_BETA],
				fallbacks: "default",
				cache_control: { type: "ephemeral" },
				thinking: { type: "adaptive" },
				output_config: {
					effort: this.effort,
					format: { type: "json_schema", schema: req.schema },
				},
				system: req.system,
				messages,
				...(apiTools.length > 0
					? {
							tools: apiTools,
							tool_choice: tired ? { type: "none" } : { type: "auto" },
						}
					: {}),
			});
			usage = addUsage(usage, this.price(res));

			switch (res.stop_reason) {
				case "refusal":
					throw new HeadError(
						`頭が断った(${res.stop_details?.category ?? "分類なし"})`,
						usage,
					);
				case "max_tokens":
					throw new HeadError("答えが長すぎて途中で切れた", usage);
				case "pause_turn":
					// web 検索の途中。続きを頼むときは assistant をそのまま戻すだけ
					if (++continuations > MAX_CONTINUATIONS) {
						throw new HeadError("web 検索が終わらない", usage);
					}
					messages.push({ role: "assistant", content: res.content });
					continue;
				case "tool_use": {
					rounds++;
					messages.push({ role: "assistant", content: res.content });
					const calls = res.content.filter(
						(b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
					);
					// 並べて呼ばれた道具の結果は 1 つの user にまとめて返す
					const results = await Promise.all(
						calls.map(
							async (
								call,
							): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
								const tool = byName.get(call.name);
								if (!tool) {
									return {
										type: "tool_result",
										tool_use_id: call.id,
										content: `${call.name} という道具は無い`,
										is_error: true,
									};
								}
								try {
									return {
										type: "tool_result",
										tool_use_id: call.id,
										content: await tool.run(call.input),
									};
								} catch (e) {
									return {
										type: "tool_result",
										tool_use_id: call.id,
										content: e instanceof Error ? e.message : String(e),
										is_error: true,
									};
								}
							},
						),
					);
					messages.push({ role: "user", content: results });
					continue;
				}
				default: {
					const text = res.content
						.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
						.map((b) => b.text)
						.join("");
					try {
						return { output: JSON.parse(text) as T, usage };
					} catch {
						throw new HeadError(
							`答えが JSON ではない: ${text.slice(0, 200)}`,
							usage,
						);
					}
				}
			}
		}
	}

	/** API を呼ぶ。鍵・課金・権限で弾かれたら、人が直せる形(HeadAccessError)に言い換える */
	private async create(
		usage: Usage,
		params: Anthropic.Beta.MessageCreateParamsNonStreaming,
	): Promise<Anthropic.Beta.BetaMessage> {
		try {
			return await this.client.beta.messages.create(params);
		} catch (e) {
			const b = claudeBlockage(e);
			if (b) throw new HeadAccessError(b.title, usage, b);
			throw e;
		}
	}

	private price(res: Anthropic.Beta.BetaMessage): Usage {
		const [inUsd, outUsd] = PRICES[res.model] ?? PRICES[this.name] ?? [5, 25];
		const u = res.usage;
		const cacheRead = u.cache_read_input_tokens ?? 0;
		const cacheWrite = u.cache_creation_input_tokens ?? 0;
		const searches = u.server_tool_use?.web_search_requests ?? 0;
		const costUsd =
			(u.input_tokens * inUsd +
				cacheRead * inUsd * 0.1 +
				cacheWrite * inUsd * 1.25 +
				u.output_tokens * outUsd) /
				1_000_000 +
			searches * WEB_SEARCH_USD;
		return {
			inputTokens: u.input_tokens + cacheRead + cacheWrite,
			outputTokens: u.output_tokens,
			costUsd,
		};
	}
}

const CONSOLE = "https://platform.claude.com";

/** Claude API のエラーのうち、人が権限や鍵を足せば直るもの */
export function claudeBlockage(e: unknown): Blockage | undefined {
	if (!(e instanceof Anthropic.APIError)) return undefined;
	const msg = e.message;
	if (e instanceof Anthropic.AuthenticationError) {
		// サブスク(Pro / Max)の OAuth トークン(claude setup-token が出すもの)は API キーとして通らない
		if (process.env.ANTHROPIC_API_KEY?.startsWith("sk-ant-oat")) {
			return {
				key: "head:auth",
				title: "Claude のサブスクのトークンが入っている(API キーではない)",
				detail: msg,
				remedy: `\`sk-ant-oat\` で始まるのは Claude Code のサブスク用のトークンで、Messages API には使えない。${CONSOLE}/settings/keys で従量課金の API キー(\`sk-ant-api\` で始まる)を作って差し替える。`,
			};
		}
		return {
			key: "head:auth",
			title: "Claude API の鍵が通らない",
			detail: msg,
			remedy: `${CONSOLE}/settings/keys で API キーを作り、サーバーの環境変数 \`ANTHROPIC_API_KEY\` に入れて再起動する(クラスタなら Infisical の値を差し替えて rollout restart)。`,
		};
	}
	if (/credit balance|billing|purchase credits/i.test(msg)) {
		return {
			key: "head:billing",
			title: "Claude API の残高が足りない",
			detail: msg,
			remedy: `${CONSOLE}/settings/billing でクレジットを足す(自動チャージも設定できる)。Ashi の 1 日の上限は ashi.json の budget.dailyUsd。`,
		};
	}
	if (
		/web.?search/i.test(msg) &&
		(e instanceof Anthropic.PermissionDeniedError ||
			e instanceof Anthropic.BadRequestError)
	) {
		return {
			key: "head:web-search",
			title: "Claude の web 検索が組織で許可されていない",
			detail: msg,
			remedy: `${CONSOLE}/settings/privacy(組織の設定)で web search を有効にする。使わせないなら ashi.json の allowWeb を false にする。`,
		};
	}
	if (e instanceof Anthropic.PermissionDeniedError) {
		return {
			key: "head:permission",
			title: "Claude API で権限が足りない",
			detail: msg,
			remedy: `API キーの属するワークスペースで、ashi.json の model(既定 claude-opus-5)が使えるか ${CONSOLE}/settings/workspaces で確かめる。`,
		};
	}
	return undefined;
}
