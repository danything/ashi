import type { Config } from "../config.ts";
import type { Tool } from "../head/head.ts";
import { type GetDeps, htmlToText, pdfToText, safeGet } from "./tools.ts";

/**
 * 論文を探して読む道具。読むだけで、鍵も要らない。
 *
 * 出版社のページ(Cell・Nature・Elsevier)は有料の壁やロボットの締め出しで 403 になることが多く、
 * 頭がそのたびに「弾かれた」と知らせていた(2026-09-25)。多くの論文には無料で読める版
 * (PMC・機関リポジトリ・著者の公開版)があるので、まずそれを探させる。
 *   find_papers: Europe PMC と OpenAlex で題・語・DOI から探し、要旨と無料で読める先を返す
 *   read_paper:  PMCID なら Europe PMC の本文、URL なら公開版の本文(PDF も)を読む
 */

const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const OPENALEX = "https://api.openalex.org";

interface EpmcResult {
	title?: string;
	authorString?: string;
	journalTitle?: string;
	journalInfo?: { journal?: { title?: string } };
	pubYear?: string;
	doi?: string;
	pmid?: string;
	pmcid?: string;
	isOpenAccess?: string;
	abstractText?: string;
}

interface OpenAlexWork {
	title?: string;
	publication_year?: number;
	doi?: string;
	primary_location?: { source?: { display_name?: string } };
	open_access?: { is_oa?: boolean; oa_url?: string | null };
	best_oa_location?: {
		pdf_url?: string | null;
		landing_page_url?: string | null;
	} | null;
	abstract_inverted_index?: Record<string, number[]> | null;
}

/** OpenAlex は要旨を「語 → 位置」の形で返すので、文に戻す */
export function invertedToText(
	inv: Record<string, number[]> | null | undefined,
): string {
	if (!inv) return "";
	const words: string[] = [];
	for (const [w, ps] of Object.entries(inv)) for (const p of ps) words[p] = w;
	return words.filter(Boolean).join(" ");
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const normDoi = (d: string) =>
	d.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();

async function getJson<T>(
	url: string,
	cfg: Pick<Config, "fetch">,
	deps: GetDeps,
): Promise<T | undefined> {
	const r = await safeGet(url, cfg, deps, { accept: "application/json" });
	if (r.status !== 200 || !r.body) return undefined;
	try {
		return JSON.parse(r.body) as T;
	} catch {
		return undefined;
	}
}

export function paperTools(
	cfg: Pick<Config, "fetch">,
	deps: GetDeps = {},
): Tool[] {
	return [
		{
			name: "find_papers",
			description:
				"論文を探す(Europe PMC と OpenAlex)。題・語・DOI から、要旨と無料で読める版(PMC・リポジトリ・著者版)の場所を返す。出版社のページが 403 や有料で読めないときは、まずこれで公開版を探す。",
			inputSchema: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description:
							"題・著者・語(英語のほうが見つかりやすい)。DOI を知っていれば DOI だけでよい",
					},
				},
				required: ["query"],
				additionalProperties: false,
			},
			readOnly: true,
			async run(input) {
				const q = String((input as { query?: unknown }).query ?? "").trim();
				if (!q) return "語が空";
				const doi = /^(https?:\/\/(dx\.)?doi\.org\/)?10\.\d{4,}\//i.test(q)
					? normDoi(q)
					: undefined;
				const epmcQuery = doi ? `DOI:"${doi}"` : q;
				const [epmc, oa] = await Promise.all([
					getJson<{ resultList?: { result?: EpmcResult[] } }>(
						`${EPMC}/search?${new URLSearchParams({ query: epmcQuery, format: "json", resultType: "core", pageSize: "5" })}`,
						cfg,
						deps,
					).catch(() => undefined),
					getJson<{ results?: OpenAlexWork[] } & OpenAlexWork>(
						doi
							? `${OPENALEX}/works/doi:${encodeURIComponent(doi)}`
							: `${OPENALEX}/works?${new URLSearchParams({ search: q, "per-page": "5" })}`,
						cfg,
						deps,
					).catch(() => undefined),
				]);
				const lines: string[] = [];
				for (const r of epmc?.resultList?.result ?? []) {
					const links = [
						r.pmcid ? `本文: read_paper に pmcid "${r.pmcid}"` : "",
						r.doi ? `https://doi.org/${r.doi}` : "",
					].filter(Boolean);
					lines.push(
						[
							`■ ${r.title ?? "(題なし)"}(${r.pubYear ?? "?"}、${r.journalInfo?.journal?.title ?? r.journalTitle ?? "?"})`,
							r.authorString ? `著者: ${clip(r.authorString, 120)}` : "",
							`DOI: ${r.doi ?? "-"} / PMID: ${r.pmid ?? "-"} / PMCID: ${r.pmcid ?? "-"} / 無料で読める: ${r.isOpenAccess === "Y" ? "はい" : "不明"}`,
							r.abstractText
								? `要旨: ${clip(htmlToText(r.abstractText), 1500)}`
								: "",
							links.length ? `先: ${links.join(" / ")}` : "",
						]
							.filter(Boolean)
							.join("\n"),
					);
				}
				const works = oa?.results ?? (oa?.title ? [oa] : []);
				const seen = new Set(
					(epmc?.resultList?.result ?? []).map((r) =>
						r.doi ? normDoi(r.doi) : "",
					),
				);
				for (const w of works) {
					if (w.doi && seen.has(normDoi(w.doi))) {
						// 同じ論文なら、無料で読める先だけ足す
						const oaUrl = w.best_oa_location?.pdf_url ?? w.open_access?.oa_url;
						if (oaUrl)
							lines.push(
								`↳ ${w.title ?? ""} の公開版: ${oaUrl}(read_paper に url で渡す)`,
							);
						continue;
					}
					const abs = invertedToText(w.abstract_inverted_index);
					const oaUrl =
						w.best_oa_location?.pdf_url ??
						w.open_access?.oa_url ??
						w.best_oa_location?.landing_page_url;
					lines.push(
						[
							`■ ${w.title ?? "(題なし)"}(${w.publication_year ?? "?"}、${w.primary_location?.source?.display_name ?? "?"})`,
							`DOI: ${w.doi ? normDoi(w.doi) : "-"} / 無料で読める: ${w.open_access?.is_oa ? "はい" : "いいえ・不明"}`,
							abs ? `要旨: ${clip(abs, 1500)}` : "",
							oaUrl ? `公開版: ${oaUrl}(read_paper に url で渡す)` : "",
						]
							.filter(Boolean)
							.join("\n"),
					);
				}
				return lines.length
					? lines.join("\n\n")
					: "見つからない。語を英語にする、題の一部だけにする、DOI で探す、を試す";
			},
		},
		{
			name: "read_paper",
			description:
				"論文の本文を読む。pmcid(PMC で始まる)なら Europe PMC の本文を、url なら find_papers が返した公開版(PDF も読める)を読む。",
			inputSchema: {
				type: "object",
				properties: {
					pmcid: { type: "string", description: "PMC で始まる ID。無ければ空" },
					url: {
						type: "string",
						description: "公開版の URL。pmcid があれば空でよい",
					},
				},
				required: ["pmcid", "url"],
				additionalProperties: false,
			},
			readOnly: true,
			async run(input) {
				const { pmcid = "", url = "" } = input as {
					pmcid?: string;
					url?: string;
				};
				const id = pmcid.trim().toUpperCase();
				if (/^PMC\d+$/.test(id)) {
					const r = await safeGet(`${EPMC}/${id}/fullTextXML`, cfg, deps);
					if (r.status === 200 && r.body)
						return `${id} の本文(Europe PMC)\n\n${htmlToText(r.body).slice(0, cfg.fetch.maxBytes)}`;
					return `${id} の本文は Europe PMC で読めなかった(${r.status})。find_papers の公開版の URL を試す`;
				}
				if (!url.trim()) return "pmcid か url のどちらかが要る";
				const r = await safeGet(url.trim(), cfg, deps);
				if (r.pdf)
					return `${r.status} ${r.url}\n\n${(await pdfToText(r.pdf)).slice(0, cfg.fetch.maxBytes)}`;
				if (r.status >= 400)
					return `${r.status} で読めなかった。ほかの公開版を find_papers で探す`;
				if (!r.body) return `(${r.status} ${r.type}: 文字ではないので読まない)`;
				return `${r.status} ${r.url}\n\n${/html/.test(r.type) ? htmlToText(r.body) : r.body}`;
			},
		},
	];
}
