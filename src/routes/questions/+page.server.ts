import {
	ownerHandles,
	ownerPull,
	strangerLanding,
} from "$lib/server/ashi/legs/guard";
import { score } from "$lib/server/ashi/legs/select";
import { store } from "$lib/server/runtime";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	const all = store.questions();
	const pull = ownerPull(all, ownerHandles(store.config()));
	const landing = strangerLanding(all, ownerHandles(store.config()));
	const byId = new Map(all.map((q) => [q.id, q]));
	const qs = all.map((q) => {
		const parent = q.parentId ? byId.get(q.parentId) : undefined;
		// 個性の問いから生まれた先回りの問い(橋渡し)。どこから来たかを見せる
		const bridgedFrom =
			q.track === "owner" && parent?.track === "self" ? parent.text : undefined;
		return { ...q, score: score(q), bridgedFrom };
	});
	return {
		open: qs
			.filter((q) => q.status === "open")
			.sort((a, b) => b.score - a.score),
		pull,
		landing,
		parked: qs.filter((q) => q.status === "parked"),
		closed: qs
			.filter((q) => q.status === "answered" || q.status === "dropped")
			.sort((a, b) =>
				(b.lastVisitedAt ?? b.createdAt).localeCompare(
					a.lastVisitedAt ?? a.createdAt,
				),
			)
			.slice(0, 100),
	};
};

export const actions: Actions = {
	/** 未測定の棚から戻す(新しい探し場所を思いついたときなど)。見つからなかった回数も 0 に */
	reopen: async ({ request }) => {
		const id = String((await request.formData()).get("id") ?? "");
		store.updateQuestions((qs) =>
			qs.map((q) => (q.id === id ? { ...q, status: "open", misses: 0 } : q)),
		);
		return {};
	},
};
