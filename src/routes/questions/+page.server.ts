import { score } from "$lib/server/ashi/legs/select";
import { store } from "$lib/server/runtime";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	const all = store.questions();
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
		closed: qs
			.filter((q) => q.status !== "open")
			.sort((a, b) =>
				(b.lastVisitedAt ?? b.createdAt).localeCompare(
					a.lastVisitedAt ?? a.createdAt,
				),
			)
			.slice(0, 100),
	};
};
