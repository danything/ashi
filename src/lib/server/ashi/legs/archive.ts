import type { Config } from "../config.ts";
import type { Tool } from "../head/head.ts";
import { type GetDeps, htmlToText, pdfToText, safeGet } from "./tools.ts";

/**
 * 本物のページが読めないとき、公開のアーカイブにある写しを読む道具。読むだけで、鍵も要らない。
 *
 * 公取委(jftc.go.jp)や中小企業庁(chusho.meti.go.jp)は Akamai がロボットを締め出していて、
 * トップページから 403 になる(2026-09-25)。ブラウザを装って抜けることはしない。
 * Internet Archive の Wayback Machine に写しがあることが多いので、それを読む。
 *   1. available API で、いちばん新しい写しの時刻を探す。この API は同じ URL でも空を返すことがあるので、
 *      空なら CDX API(写しの一覧)で、状態が 200 のいちばん新しいものを引き直す
 *   2. `<時刻>id_/<URL>` の形で読む(id_ を付けると、Wayback の枠を足さない元のままの本文が返る)
 * 写しが無ければ、国立国会図書館の WARP(官公庁のサイトを集めている)の検索先を返す。
 */

const WAYBACK = "https://archive.org/wayback/available";
const CDX = "https://web.archive.org/cdx/search/cdx";

interface Available {
	archived_snapshots?: {
		closest?: { available?: boolean; status?: string; timestamp?: string };
	};
}

/** 写しの時刻(YYYYMMDDhhmmss)を読みやすくする */
export const snapshotDate = (ts: string) =>
	ts.length >= 8 ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : ts;

/** いちばん新しい写しの時刻。無ければ undefined */
async function latestSnapshot(
	url: string,
	cfg: Pick<Config, "fetch">,
	deps: GetDeps,
): Promise<string | undefined> {
	try {
		const r = await safeGet(
			`${WAYBACK}?${new URLSearchParams({ url })}`,
			cfg,
			deps,
		);
		const c = (JSON.parse(r.body) as Available).archived_snapshots?.closest;
		if (c?.timestamp && c.available !== false) return c.timestamp;
	} catch {
		// CDX で引き直す
	}
	try {
		const r = await safeGet(
			`${CDX}?${new URLSearchParams({ url, output: "json", limit: "-1", filter: "statuscode:200", fl: "timestamp" })}`,
			cfg,
			deps,
		);
		const rows = JSON.parse(r.body) as string[][];
		// 先頭の行は見出し(["timestamp"])
		return rows.length > 1 ? rows[rows.length - 1]?.[0] : undefined;
	} catch {
		return undefined;
	}
}

export const warpSearchUrl = (url: string) =>
	`https://warp.ndl.go.jp/search/?${new URLSearchParams({ url })}`;

export function archiveTool(
	cfg: Pick<Config, "fetch">,
	deps: GetDeps = {},
	/** 写しが読めたとき(その先の「弾かれた」を片づける。写しで足りたので持ち主の手は要らない) */
	onCopy?: (host: string) => void,
): Tool {
	return {
		name: "archived_copy",
		description:
			"ページがロボットの締め出し(403 など)で読めないとき、Internet Archive(Wayback Machine)にある写しを読む。いちばん新しい写しの日付と本文を返す。写しは古いことがあるので、日付を確かめてから使う。",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "読めなかったページの URL" },
			},
			required: ["url"],
			additionalProperties: false,
		},
		readOnly: true,
		async run(input) {
			const raw = String((input as { url?: unknown }).url ?? "").trim();
			let target: URL;
			try {
				target = new URL(raw);
			} catch {
				return "URL として読めない";
			}
			if (target.protocol !== "http:" && target.protocol !== "https:")
				return "http と https だけ";
			const ts = await latestSnapshot(target.toString(), cfg, deps);
			if (!ts)
				return `Wayback Machine に写しが無い。官公庁のページなら国立国会図書館の WARP にあるかもしれない: ${warpSearchUrl(target.toString())}`;
			const r = await safeGet(
				`https://web.archive.org/web/${ts}id_/${target.toString()}`,
				cfg,
				deps,
			);
			if (r.status < 400) onCopy?.(target.hostname);
			const head = `写し ${snapshotDate(ts)}(${r.status})元: ${target}`;
			if (r.pdf)
				return `${head}\n\n${(await pdfToText(r.pdf)).slice(0, cfg.fetch.maxBytes)}`;
			if (!r.body) return `${head}\n\n(${r.type}: 文字ではないので読まない)`;
			const text = /html/.test(r.type) ? htmlToText(r.body) : r.body;
			return `${head}\n\n${text}`;
		},
	};
}
