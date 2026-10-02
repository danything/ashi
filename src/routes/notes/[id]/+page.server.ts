import { error } from "@sveltejs/kit";
import { md } from "#lib/server/markdown.ts";
import { store } from "#lib/server/runtime.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
	const note = store.notes().find((n) => n.id === params.id);
	const body = note && store.noteBody(note.id);
	if (!note || body === undefined) error(404, "ノートが無い");
	const question = store.questions().find((q) => q.id === note.questionId);
	return { note, question, html: md(body) };
};
