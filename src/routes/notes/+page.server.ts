import { store } from "$lib/server/runtime";
import { diaryView } from "$lib/server/views";
import type { PageServerLoad } from "./$types";

/** ノートと日記を並べる(歩いて分かったことと、その日の振り返りを見比べられるように) */
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
	return { notes, q, diary: diaryView(url.searchParams.get("day")) };
};
