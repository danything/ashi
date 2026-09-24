/**
 * 頭(LLM)とのつなぎ目。足(Ashi 本体)は頭をこの形でしか知らない。
 * 頭を差し替えるときは Head を実装した別のクラスを作り、cli.ts で渡すものを変えるだけにする。
 */

export type JsonSchema = { [key: string]: unknown };

/** 頭が使える道具。実行するのは足で、読み取り専用のものしか渡さない(legs/tools.ts) */
export interface Tool {
	name: string;
	description: string;
	inputSchema: JsonSchema;
	/** 足が中身を見て、書き込みや外への副作用が無いと確かめた印 */
	readOnly: true;
	run(input: unknown): Promise<string>;
}

export interface Turn {
	role: "user" | "assistant";
	text: string;
}

export interface Usage {
	inputTokens: number;
	outputTokens: number;
	/** 頭の側が知っている料金で見積もった額(ドル) */
	costUsd: number;
}

export interface ThinkRequest {
	/** ログと料金の内訳に出す名前(explore / reflect など) */
	task: string;
	system: string;
	/** ここまでのやり取り(人との対話)。古い順。最後の問いかけは prompt に置く */
	history?: Turn[];
	prompt: string;
	/** 答えの形。頭はこの JSON だけを返す */
	schema: JsonSchema;
	tools?: Tool[];
	/** 道具を使う往復の上限。超えたら道具を取り上げて答えを出させる */
	maxToolRounds?: number;
	/** この 1 回で使ってよい額(ドル)。超えそうなら道具を取り上げて答えを出させる */
	maxCostUsd?: number;
	/** 頭の側が持っている調べ物の手段(Claude ならサーバー側の web 検索)を使ってよいか */
	allowWeb?: boolean;
}

export interface ThinkResult<T> {
	output: T;
	usage: Usage;
}

export interface Head {
	/** 名前(ログ用。モデル名など) */
	readonly name: string;
	think<T>(req: ThinkRequest): Promise<ThinkResult<T>>;
}

/** 頭が答えを返せなかった(拒否・形が違う・上限切れ)。足はこの 1 歩を捨てて休む */
export class HeadError extends Error {
	constructor(
		message: string,
		readonly usage: Usage,
	) {
		super(message);
		this.name = "HeadError";
	}
}

export const noUsage = (): Usage => ({
	inputTokens: 0,
	outputTokens: 0,
	costUsd: 0,
});

export const addUsage = (a: Usage, b: Usage): Usage => ({
	inputTokens: a.inputTokens + b.inputTokens,
	outputTokens: a.outputTokens + b.outputTokens,
	costUsd: a.costUsd + b.costUsd,
});
