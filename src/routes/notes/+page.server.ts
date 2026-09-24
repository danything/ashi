import { store } from "$lib/server/runtime";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ url }) => {
	const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
	const questions = new Map(store.questions().map((x) => [x.id, x]));
	const notes = store
		.notes()
		.filter(
			(n) =>
				!q ||
				[n.title, n.summary, n.theme].some((s) => s.toLowerCase().includes(q)),
		)
		.reverse()
		.map((n) => ({
			...n,
			track: questions.get(n.questionId)?.track ?? "self",
		}));
	return { notes, q };
};
