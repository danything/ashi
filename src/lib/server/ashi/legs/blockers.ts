import type { Blockage } from "../head/head.ts";
import type { Store } from "../state.ts";

/**
 * 弾かれたこと(権限・鍵・課金・巡回の失敗)。人が手を打つまで進めないものを集め、持ち主に知らせる。
 *
 * - 同じ key は 1 件にまとめ、回数と最後の時刻を足す
 * - 初めて出たとき(片づいた後にまた出たときも)だけ通知する(NOTIFY_WEBHOOK_URL。Slack / Mattermost 形式)
 * - 同じ先がうまくいったら自動で片づける(resolveBlockers)。頭が知らせたものは人が片づける
 */

export interface BlockerRecord extends Blockage {
	/** head: 頭(Claude API)/ feed: 足跡の巡回 / fetch: 頭の fetch_url / report: 頭が歩いていて気づいたもの / x: Ashi の X アカウント */
	source: "head" | "feed" | "fetch" | "report" | "x";
	firstAt: string;
	lastAt: string;
	count: number;
	resolvedAt?: string;
}

export const isOpen = (b: BlockerRecord) => !b.resolvedAt;

type Notify = (text: string) => Promise<void>;

/** Slack 互換の incoming webhook({ text })。Mattermost もこの形で受ける */
export const webhookNotify: Notify = async (text) => {
	const url = process.env.NOTIFY_WEBHOOK_URL?.trim();
	if (!url) return;
	try {
		await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text }),
			signal: AbortSignal.timeout(10_000),
		});
	} catch (e) {
		console.warn("[ashi] 通知を送れなかった", e);
	}
};

export async function raiseBlocker(
	store: Store,
	source: BlockerRecord["source"],
	b: Blockage,
	now: Date,
	notify: Notify = webhookNotify,
): Promise<boolean> {
	const all = store.blockers();
	const prev = all[b.key];
	const fresh = !prev || !isOpen(prev);
	const rec: BlockerRecord = {
		...b,
		source,
		firstAt: fresh ? now.toISOString() : (prev?.firstAt ?? now.toISOString()),
		lastAt: now.toISOString(),
		count: fresh ? 1 : (prev?.count ?? 0) + 1,
	};
	store.saveBlockers({ ...all, [b.key]: rec });
	if (fresh) {
		store.log("blocked", { key: b.key, title: b.title });
		const origin = process.env.ORIGIN ? `\n${process.env.ORIGIN}/blocked` : "";
		await notify(
			`Ashi が弾かれた: ${b.title}${b.detail ? `\n> ${b.detail.slice(0, 300)}` : ""}\n\n${b.remedy}${origin}`,
		);
	}
	return fresh;
}

/** key が prefix で始まる開いたものを片づける(同じ先がうまくいったとき) */
export function resolveBlockers(store: Store, prefix: string, now: Date): void {
	const all = store.blockers();
	let changed = false;
	for (const [k, b] of Object.entries(all)) {
		if (isOpen(b) && (k === prefix || k.startsWith(prefix))) {
			all[k] = { ...b, resolvedAt: now.toISOString() };
			changed = true;
		}
	}
	if (changed) store.saveBlockers(all);
}

export function openBlockers(store: Store): BlockerRecord[] {
	return Object.values(store.blockers())
		.filter(isOpen)
		.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** 頭に見せる、いま弾かれていること */
export function blockersText(store: Store): string {
	const open = openBlockers(store);
	return open.length
		? open.map((b) => `- ${b.title}(${b.count} 回)`).join("\n")
		: "(無い)";
}

// ---- 巡回と fetch_url の失敗を、人が直せる形に言い換える

const GITHUB_TOKEN_HOWTO =
	"https://github.com/settings/personal-access-tokens/new で fine-grained token を作る(Repository access は Public repositories、権限は何も付けない)。サーバーの環境変数 `GITHUB_TOKEN` に入れて再起動する。";

export function feedBlockage(
	feed: { id: string; kind: string; target: string },
	error: string,
): Blockage {
	const key = `feed:${feed.id}`;
	if (feed.kind === "x") {
		if (/X_BEARER_TOKEN/.test(error)) {
			return {
				key,
				title: "X を読む鍵が無い",
				detail: error,
				remedy:
					"https://developer.x.com/en/portal/dashboard で Project と App を作り、ユーザーのポストを読めるプラン(有料)にして Bearer Token を発行する。サーバーの環境変数 `X_BEARER_TOKEN` に入れて再起動する。X を読まないなら ashi.json の feeds から外す。",
			};
		}
		return {
			key,
			title: "X に弾かれた",
			detail: error,
			remedy:
				"Bearer Token が失効したか、プランが users/:id/tweets を読めない。developer.x.com で鍵を作り直すかプランを確かめ、`X_BEARER_TOKEN` を差し替える。",
		};
	}
	if (feed.kind === "forgejo") {
		if (/FORGEJO_(URL|TOKEN)/.test(error) || /40[13]/.test(error)) {
			return {
				key,
				title: "Forgejo を読む鍵が無いか、通らない",
				detail: error,
				remedy:
					"https://fj.doany.io/user/settings/applications でアクセストークンを作る(権限は read:user と read:repository だけ)。Infisical の /ashi/ashi-secrets に `forgejo-token` として入れる。`FORGEJO_URL` は deploy/deployment.yaml に書いてある(クラスタの中の Service)。",
			};
		}
		return {
			key,
			title: `Forgejo の ${feed.target} を読めない`,
			detail: error,
			remedy:
				"ユーザー名が合っているか ashi.json の feeds を、Forgejo が動いているかを確かめる。",
		};
	}
	if (feed.kind === "github") {
		if (/40[13]|429/.test(error)) {
			return {
				key,
				title: "GitHub の読み取りが弾かれた(回数の上限か鍵)",
				detail: error,
				remedy: `鍵無しは 1 時間 60 回まで。${GITHUB_TOKEN_HOWTO} 既に入れているなら、期限切れでないか確かめる。`,
			};
		}
		return {
			key,
			title: `GitHub の ${feed.target} を読めない`,
			detail: error,
			remedy: "ユーザー名が合っているか ashi.json の feeds を確かめる。",
		};
	}
	return {
		key,
		title: `足跡 ${feed.id} を読めない`,
		detail: error,
		remedy: /40[13]/.test(error)
			? "フィードがログインを求めている。公開のフィード URL に替えるか、読ませたい記事を「持ち主」の画面で貼り付ける。"
			: "ashi.json の feeds の URL が今も有効か確かめる(記事一覧のページではなく RSS / Atom の URL)。",
	};
}

/** 頭の fetch_url が弾かれたとき。Ashi は読むだけなので、ログインや鍵の要るページには入らない */
export function fetchBlockage(
	host: string,
	status: number | "private",
): Blockage | undefined {
	if (status === "private") {
		return {
			key: "fetch:private",
			title: "手元のネットワークを読もうとして止めた",
			remedy:
				"ガードレールで、プライベートアドレス(クラスタの中・家の LAN)は読まない。読ませたい中身があれば「持ち主」の画面で貼り付ける。",
		};
	}
	if (![401, 403, 407, 451].includes(status)) return undefined;
	return {
		key: `fetch:${host}`,
		title: `${host} に弾かれた(${status})`,
		remedy:
			"ログインが要るか、ロボットを締め出しているページ。Ashi は読むだけの足なのでログインはしない。要る中身なら「持ち主」の画面で貼り付けるか、公開されている別の出典を話しかけて教える。",
	};
}
