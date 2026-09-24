import { score } from "$lib/server/ashi/legs/select";
import { store } from "$lib/server/runtime";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	const qs = store.questions().map((q) => ({ ...q, score: score(q) }));
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
