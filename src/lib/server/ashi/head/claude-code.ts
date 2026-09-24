import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Blockage,
	type Head,
	HeadAccessError,
	HeadError,
	noUsage,
	type ThinkRequest,
	type ThinkResult,
	type Usage,
} from "./head.ts";

/**
 * サブスク(Pro / Max)で動く頭。公式の Claude Code の CLI を `claude -p` で 1 回ずつ呼ぶ。
 * Messages API はサブスクのトークンを受け付けないので、CLI を通す(Forgejo の AI レビューと同じ形)。
 *
 * 足の道具(fetch_url・search_notes・read_note)は CLI に渡せないので、組み込みの道具で置き換える:
 *   ノートを読む → Read。**状態ディレクトリの notes/ の中だけ**(ほかのパスは権限で拒まれる。2026-09-25 に確かめた)
 *   web を読む   → WebFetch、web を探す → WebSearch
 * 書き込み・Bash は渡さない。手元のネットワークを読ませない制限は CLI の中では掛けられないので、
 * クラスタでは NetworkPolicy(deploy/networkpolicy.yaml)で Pod の外向きを止める。
 *
 * 使った額はドルでは数えない(サブスクなので 0)。代わりに足が 1 日の歩数で止める(config の maxStepsPerDay)。
 */

export interface ClaudeCodeHeadOptions {
	model?: string;
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	/** 状態ディレクトリ。CLI をここで動かし、notes/ だけを読ませる */
	home: string;
	/** CLI の場所(既定は PATH の claude) */
	bin?: string;
	/** 1 回の上限(ミリ秒)。調べ物で長くなるので長め */
	timeoutMs?: number;
	env?: Record<string, string | undefined>;
}

interface CliResult {
	is_error?: boolean;
	api_error_status?: number | null;
	result?: string;
	structured_output?: unknown;
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cache_read_input_tokens?: number;
		cache_creation_input_tokens?: number;
	};
}

const TOOL_HINT = `
道具について: 過去のノートは notes/<id>.md にある(id は最近のノートの一覧の [ ] の中)。Read で読める。
web は WebSearch で探し、WebFetch で読む。ファイルを書く道具やコマンドは無い。`;

export class ClaudeCodeHead implements Head {
	readonly name: string;
	private readonly opts: ClaudeCodeHeadOptions;

	constructor(opts: ClaudeCodeHeadOptions) {
		this.name = opts.model ?? "claude-opus-5-5";
		this.opts = opts;
	}

	async think<T>(req: ThinkRequest): Promise<ThinkResult<T>> {
		const tools: string[] = [];
		const allowed: string[] = [];
		if (req.tools?.length) {
			tools.push("Read", "WebFetch");
			allowed.push("Read(./notes/**)", "WebFetch");
		}
		if (req.allowWeb) {
			tools.push("WebSearch");
			allowed.push("WebSearch");
		}

		// system は長い(コア原則・持ち主の地図・自己記述)ので、引数ではなくファイルで渡す
		const dir = mkdtempSync(join(tmpdir(), "ashi-head-"));
		try {
			const sysFile = join(dir, "system.md");
			writeFileSync(
				sysFile,
				tools.length ? `${req.system}\n${TOOL_HINT}` : req.system,
			);
			const args = [
				"-p",
				"--output-format",
				"json",
				"--json-schema",
				JSON.stringify(req.schema),
				"--system-prompt-file",
				sysFile,
				"--model",
				this.name,
				"--effort",
				this.opts.effort ?? "high",
				"--tools",
				tools.join(","),
				...(allowed.length ? ["--allowedTools", ...allowed] : []),
				// 手元の設定・MCP・スキルを読ませない(Ashi の頭として決めた道具だけにする)
				"--setting-sources",
				"",
				"--strict-mcp-config",
				"--disable-slash-commands",
				"--no-session-persistence",
				"--max-turns",
				String((req.maxToolRounds ?? 8) + 3),
			];
			// プロンプトは長い(持ち主の材料で 60,000 字になる)ので標準入力から渡す
			const out = await this.run(args, promptWithHistory(req));
			return this.parse<T>(out);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	private run(
		args: string[],
		stdin: string,
	): Promise<{ stdout: string; stderr: string; code: number | null }> {
		const env = { ...(this.opts.env ?? process.env) };
		// API キーがあると CLI はそちらを使ってしまう。サブスクのトークンだけを渡す
		delete env.ANTHROPIC_API_KEY;
		// 頭に要らない秘密は渡さない(Read は notes/ に絞ってあるが、念のため)
		for (const k of [
			"SESSION_SECRET",
			"ENTRA_CLIENT_SECRET",
			"GITHUB_TOKEN",
			"X_BEARER_TOKEN",
			"FORGEJO_TOKEN",
			"NOTIFY_WEBHOOK_URL",
		]) {
			delete env[k];
		}
		return new Promise((resolve, reject) => {
			const child = spawn(this.opts.bin ?? "claude", args, {
				cwd: this.opts.home,
				env,
			});
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (b) => {
				stdout += b;
			});
			child.stderr.on("data", (b) => {
				stderr += b;
			});
			const timer = setTimeout(
				() => child.kill("SIGTERM"),
				this.opts.timeoutMs ?? 15 * 60_000,
			);
			child.on("error", (e) => {
				clearTimeout(timer);
				reject(
					new HeadAccessError(
						`Claude Code の CLI を起動できない: ${e.message}`,
						noUsage(),
						{
							key: "head:claude-code-missing",
							title: "Claude Code の CLI が無い",
							detail: e.message,
							remedy:
								"イメージに claude が入っていない。Dockerfile の Claude Code を入れる段を確かめる。手元なら `curl -fsSL https://claude.ai/install.sh | bash`。",
						},
					),
				);
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				resolve({ stdout, stderr, code });
			});
			child.stdin.end(stdin);
		});
	}

	private parse<T>(out: {
		stdout: string;
		stderr: string;
		code: number | null;
	}): ThinkResult<T> {
		let r: CliResult;
		try {
			r = JSON.parse(out.stdout) as CliResult;
		} catch {
			throw new HeadError(
				`Claude Code の出力が JSON ではない(終了コード ${out.code}): ${(out.stderr || out.stdout).slice(0, 300)}`,
				noUsage(),
			);
		}
		const usage: Usage = {
			inputTokens:
				(r.usage?.input_tokens ?? 0) +
				(r.usage?.cache_read_input_tokens ?? 0) +
				(r.usage?.cache_creation_input_tokens ?? 0),
			outputTokens: r.usage?.output_tokens ?? 0,
			// サブスクなのでドルでは数えない
			costUsd: 0,
		};
		if (r.is_error) {
			const b = subscriptionBlockage(
				r.api_error_status ?? null,
				r.result ?? "",
			);
			if (b) throw new HeadAccessError(b.title, usage, b);
			throw new HeadError(
				`Claude Code がつまずいた: ${(r.result ?? "").slice(0, 300)}`,
				usage,
			);
		}
		if (r.structured_output === undefined || r.structured_output === null) {
			throw new HeadError(
				`答えが決めた形で返らなかった: ${(r.result ?? "").slice(0, 200)}`,
				usage,
			);
		}
		return { output: r.structured_output as T, usage };
	}
}

/** 対話の履歴は CLI に渡す口が無いので、プロンプトの前に書き起こして付ける */
function promptWithHistory(req: ThinkRequest): string {
	if (!req.history?.length) return req.prompt;
	const lines = req.history.map(
		(t) => `${t.role === "user" ? "持ち主" : "あなた"}: ${t.text}`,
	);
	return `ここまでの対話:\n\n${lines.join("\n\n")}\n\n---\n\n${req.prompt}`;
}

/** CLI のエラーのうち、人が手を打てば直るもの */
export function subscriptionBlockage(
	status: number | null,
	message: string,
): Blockage | undefined {
	if (status === 401 || /not logged in|authenticate|oauth/i.test(message)) {
		return {
			key: "head:auth",
			title: "Claude Code のサブスクのトークンが通らない",
			detail: message,
			remedy:
				"手元で `claude setup-token` を実行してトークン(`sk-ant-oat…`、1 年有効)を出し、Infisical の /ashi/ashi-secrets の `claude-code-oauth-token` を差し替える。",
		};
	}
	if (status === 429 || /usage limit|limit reached|rate limit/i.test(message)) {
		return {
			key: "head:subscription-limit",
			title: "サブスクの使用量の上限に当たった",
			detail: message,
			remedy:
				"5 時間ごと・週ごとの上限で、手元の Claude Code と共有している。戻るまで Ashi は長く休む。減らすなら ASHI_CONFIG の maxStepsPerDay を下げる。",
		};
	}
	return undefined;
}
