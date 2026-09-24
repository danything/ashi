import { error } from "@sveltejs/kit";
import { md } from "$lib/server/markdown";
import { store } from "$lib/server/runtime";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(params.day)) error(404, "日付の形が違う");
	const body = store.diary(params.day);
	if (!body) error(404, "その日の日記は無い");
	return { day: params.day, days: store.diaryDays(), html: md(body) };
};
