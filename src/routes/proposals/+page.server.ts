import type { Proposal } from "$lib/server/ashi/state";
import { md } from "$lib/server/markdown";
import { store } from "$lib/server/runtime";
import { blockedView } from "$lib/server/views";
import type { Actions, PageServerLoad } from "./$types";

/** 改善案を issue にするリポジトリ(公開の GitHub) */
const REPO = process.env.ASHI_REPO || "danything/ashi";

/**
 * GitHub の新しい issue の画面を、題と本文を入れた状態で開く URL。
 * **issue を作るのは持ち主**(Ashi は外に書き込まない。鍵も要らない)
 */
function newIssueUrl(p: {
	title: string;
	why: string;
	idea: string;
	count: number;
}): string {
	const body = `## 困ったこと\n\n${p.why}\n\n## こうすればよさそう\n\n${p.idea}\n\n---\nAshi の内省から(${p.count} 回出た)`;
	const q = new URLSearchParams({
		title: p.title,
		body,
		labels: "ashi-proposal",
	});
	return `https://github.com/${REPO}/issues/new?${q}`;
}

export const load: PageServerLoad = () => {
	const all = store
		.proposals()
		.sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
		.map((p) => ({
			...p,
			whyHtml: md(p.why),
			ideaHtml: md(p.idea),
			newIssueUrl: newIssueUrl(p),
		}));
	return {
		open: all.filter((p) => p.status === "open"),
		done: all.filter((p) => p.status !== "open").slice(0, 50),
		// 弾かれたことを並べる(どちらも「Ashi が進めなかったこと」なので見比べて直す)
		blocked: blockedView(),
	};
};

function setStatus(id: string, status: Proposal["status"], issueUrl?: string) {
	store.saveProposals(
		store
			.proposals()
			.map((p) =>
				p.id === id ? { ...p, status, ...(issueUrl ? { issueUrl } : {}) } : p,
			),
	);
}

export const actions: Actions = {
	filed: async ({ request }) => {
		const f = await request.formData();
		const url = String(f.get("issueUrl") ?? "").trim();
		setStatus(
			String(f.get("id") ?? ""),
			"filed",
			/^https:\/\/github\.com\//.test(url) ? url : undefined,
		);
		return {};
	},
	done: async ({ request }) => {
		setStatus(String((await request.formData()).get("id") ?? ""), "done");
		return {};
	},
	dismiss: async ({ request }) => {
		setStatus(String((await request.formData()).get("id") ?? ""), "dismissed");
		return {};
	},
	reopen: async ({ request }) => {
		setStatus(String((await request.formData()).get("id") ?? ""), "open");
		return {};
	},
};
