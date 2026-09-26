import type { Config } from "../config.ts";
import type { NewsState, Store } from "../state.ts";
import { parseFeed } from "./feeds.ts";
import { type GetDeps, safeGet } from "./tools.ts";

/**
 * 世の中の動きを、見出しだけ目にしておく。
 *
 * 台風の話を振られて「ニュースは読んでいない」と返した(2026-09-26)。人が台風を知っているのは、
 * 話す前にニュースや窓の外でなんとなく目にしていたからで、話しながら検索するからではない。
 * 同じ形にする。
 * - 見出しだけを読む(中身は読まない。「何となく目にした」程度)。頭は呼ばないので費用はかからない
 * - 数日で忘れる(keepDays)。人も先週のニュースは細かく覚えていない
 * - 見せるのは話すときと X で返すときだけ。持ち主の地図にも問い探しにも入れない
 * - 目にしなかったことは知らない。そのときは知ったかぶりせずに聞く
 */

const MAX_ITEMS = 60;
const SHOW = 30;

export async function refreshNews(
	store: Store,
	now: Date,
	deps: GetDeps = {},
): Promise<NewsState | undefined> {
	const cfg = store.config();
	if (!cfg.news.enabled || !cfg.news.feeds.length) return undefined;
	const prev = store.news();
	if (
		prev.lastAt &&
		now.getTime() - Date.parse(prev.lastAt) < cfg.news.everyHours * 3600e3
	)
		return undefined;
	const fresh: NewsState["items"] = [];
	for (const url of cfg.news.feeds) {
		try {
			const r = await safeGet(url, cfg, deps);
			if (r.status >= 400) continue;
			const source = new URL(url).hostname.replace(/^www\d*\./, "");
			for (const it of parseFeed(r.body).slice(0, 30)) {
				const at = it.at ? new Date(it.at) : now;
				fresh.push({
					title: it.title.slice(0, 120),
					at: Number.isNaN(at.getTime()) ? now.toISOString() : at.toISOString(),
					source,
				});
			}
		} catch {
			// 読めなかった配信元は飛ばす(ニュースは無くても話せる)
		}
	}
	const next = mergeNews(prev.items, fresh, now, cfg.news);
	const state = { lastAt: now.toISOString(), items: next };
	store.saveNews(state);
	return state;
}

/** 見出しを重ねて、keepDays を過ぎたものを忘れる。新しい順 */
export function mergeNews(
	prev: NewsState["items"],
	fresh: NewsState["items"],
	now: Date,
	cfg: Pick<Config["news"], "keepDays">,
): NewsState["items"] {
	const byTitle = new Map<string, NewsState["items"][number]>();
	for (const it of [...prev, ...fresh])
		if (!byTitle.has(it.title)) byTitle.set(it.title, it);
	const cutoff = now.getTime() - cfg.keepDays * 86400e3;
	return [...byTitle.values()]
		.filter((it) => Date.parse(it.at) >= cutoff)
		.sort((a, b) => b.at.localeCompare(a.at))
		.slice(0, MAX_ITEMS);
}

/** 話すときに見せる形 */
export function newsText(items: NewsState["items"]): string {
	if (!items.length) return "(この数日、ニュースは目にしていない)";
	const md = (iso: string) => {
		const d = new Date(iso);
		return `${d.getMonth() + 1}/${d.getDate()}`;
	};
	return items
		.slice(0, SHOW)
		.map((it) => `- ${md(it.at)} ${it.title}`)
		.join("\n");
}

/** プロンプトに置く段落。見出しだけ見ていることと、無いことは知らないことを伝える */
export function newsBlock(items: NewsState["items"]): string {
	return `この数日に目にしたニュースの見出し(眺めただけで、記事の中身は読んでいない):
${newsText(items)}
ここに無い出来事は知らない。知ったかぶりせず、相手に聞くこと。見出ししか見ていないので、中身は断定しない。`;
}
