import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Config } from "../config.ts";
import type { Tool } from "../head/head.ts";
import type { Store } from "../state.ts";

/**
 * 頭に渡す道具。どれも読むだけで、外の世界にも状態ディレクトリにも書き込まない。
 * 書き込む道具はここに足さないこと(読み取り専用の制約。walk.ts は readOnly でない道具を渡さない)。
 */

/** 手元のネットワークや自分自身を覗かせない */
export function isPrivateAddress(ip: string): boolean {
	const v = isIP(ip);
	if (v === 4) {
		const [a = 0, b = 0] = ip.split(".").map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 198 && (b === 18 || b === 19)) ||
			a >= 224
		);
	}
	if (v === 6) {
		const s = ip.toLowerCase();
		// IPv4 を包んだ形は中の v4 で判定する
		const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
		if (mapped?.[1]) return isPrivateAddress(mapped[1]);
		return (
			s === "::" ||
			s === "::1" ||
			s.startsWith("fc") ||
			s.startsWith("fd") ||
			s.startsWith("fe8") ||
			s.startsWith("fe9") ||
			s.startsWith("fea") ||
			s.startsWith("feb") ||
			s.startsWith("ff")
		);
	}
	return true;
}

function trustedUrl(raw: string): URL {
	const url = new URL(raw);
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new Error("http と https だけ読める");
	return url;
}

/** ガードレールで止めた(プライベートアドレス) */
export class PrivateNetworkError extends Error {}

type Resolve = (host: string) => Promise<string[]>;

const resolveAll: Resolve = async (host) =>
	(await lookup(host, { all: true })).map((a) => a.address);

/** URL が外の公開された http(s) を指しているか。駄目なら理由を投げる */
export async function assertPublicUrl(
	raw: string,
	resolve: Resolve = resolveAll,
): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`URL として読めない: ${raw}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new Error("http と https だけ読める");
	if (url.username || url.password)
		throw new Error("認証情報の付いた URL は読まない");
	const host = url.hostname.replace(/^\[|\]$/g, "");
	const addrs = isIP(host) ? [host] : await resolve(host);
	if (addrs.length === 0 || addrs.some(isPrivateAddress))
		throw new PrivateNetworkError(`手元のネットワークは読まない: ${host}`);
	return url;
}

/** HTML から本文らしい文字だけを残す(雑でよい。読むのは頭) */
export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "")
		.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n+/g, "\n\n")
		.trim();
}

export interface GetDeps {
	fetch?: typeof fetch;
	resolve?: Resolve;
}

export interface GetResult {
	status: number;
	url: URL;
	type: string;
	body: string;
}

/**
 * 公開された先を GET で読む。足が外を読むのは全部ここを通す(頭の fetch_url も、持ち主の足跡の巡回も)。
 * 転送先も 1 回ずつ確かめる(公開の URL から手元へ飛ばされないように)。文字でないものは読まない
 */
export async function safeGet(
	raw: string,
	cfg: Pick<Config, "fetch">,
	deps: GetDeps = {},
	headers: Record<string, string> = {},
	/**
	 * 人が環境変数で決めた宛先(クラスタの中の Forgejo など)。プライベートアドレスでも読むが、
	 * 転送は追わない(鍵を付けたまま別の先へ飛ばされないように)。頭が選んだ URL には使わない
	 */
	trusted = false,
): Promise<GetResult> {
	const doFetch = deps.fetch ?? fetch;
	let url = trusted
		? trustedUrl(raw)
		: await assertPublicUrl(raw, deps.resolve);
	for (let hop = 0; hop <= 5; hop++) {
		const res = await doFetch(url, {
			method: "GET",
			redirect: "manual",
			headers: {
				"user-agent": "ashi (+https://github.com/danything/ashi)",
				accept: "text/*, application/json, application/xml, */*;q=0.5",
				...headers,
			},
			signal: AbortSignal.timeout(cfg.fetch.timeoutMs),
		});
		const loc = res.headers.get("location");
		if (res.status >= 300 && res.status < 400 && loc) {
			if (trusted)
				throw new Error(`${url.host} が別の先へ転送した(${res.status})`);
			url = await assertPublicUrl(new URL(loc, url).toString(), deps.resolve);
			continue;
		}
		const type = res.headers.get("content-type") ?? "";
		if (!/text|json|xml/.test(type)) {
			return { status: res.status, url, type, body: "" };
		}
		const buf = new Uint8Array(await res.arrayBuffer()).slice(
			0,
			cfg.fetch.maxBytes,
		);
		return {
			status: res.status,
			url,
			type,
			body: new TextDecoder().decode(buf),
		};
	}
	throw new Error("転送が多すぎる");
}

/** fetch_url の結果を足に知らせる口(弾かれたら持ち主に知らせ、通ったら片づける) */
export interface FetchWatch {
	blocked(host: string, status: number | "private"): void;
	ok(host: string): void;
}

export function fetchUrlTool(
	cfg: Pick<Config, "fetch">,
	deps: GetDeps = {},
	watch?: FetchWatch,
): Tool {
	return {
		name: "fetch_url",
		description:
			"公開されている web ページを GET で読み、本文の文字を返す。POST やフォームの送信はできない。長いページは途中で切れる。",
		inputSchema: {
			type: "object",
			properties: { url: { type: "string", description: "http(s) の URL" } },
			required: ["url"],
			additionalProperties: false,
		},
		readOnly: true,
		async run(input) {
			const raw = String((input as { url?: unknown }).url ?? "");
			let r: GetResult;
			try {
				r = await safeGet(raw, cfg, deps);
			} catch (e) {
				if (e instanceof PrivateNetworkError) watch?.blocked("", "private");
				throw e;
			}
			if (r.status >= 400) watch?.blocked(r.url.hostname, r.status);
			else watch?.ok(r.url.hostname);
			if (!r.body) return `(${r.status} ${r.type}: 文字ではないので読まない)`;
			const text = /html/.test(r.type) ? htmlToText(r.body) : r.body;
			return `${r.status} ${r.url}\n\n${text}`;
		},
	};
}

/** これまでに書いたノートを読む道具。状態ディレクトリは読むだけ */
export function noteTools(store: Store): Tool[] {
	return [
		{
			name: "search_notes",
			description:
				"これまでに書いた知識のノートを語で探す。題・要約・本文に語を含むものの id と題を返す。",
			inputSchema: {
				type: "object",
				properties: { query: { type: "string" } },
				required: ["query"],
				additionalProperties: false,
			},
			readOnly: true,
			async run(input) {
				const q = String((input as { query?: unknown }).query ?? "")
					.trim()
					.toLowerCase();
				if (!q) return "語が空";
				const hits = store
					.notes()
					.filter((n) =>
						[n.title, n.summary, n.theme, store.noteBody(n.id) ?? ""].some(
							(s) => s.toLowerCase().includes(q),
						),
					)
					.slice(-20);
				return hits.length
					? hits.map((n) => `${n.id}\t${n.theme}\t${n.title}`).join("\n")
					: "見つからない";
			},
		},
		{
			name: "read_note",
			description: "ノートの本文を id で読む。",
			inputSchema: {
				type: "object",
				properties: { id: { type: "string" } },
				required: ["id"],
				additionalProperties: false,
			},
			readOnly: true,
			async run(input) {
				const id = String((input as { id?: unknown }).id ?? "");
				return store.noteBody(id) ?? `${id} というノートは無い`;
			},
		},
	];
}
