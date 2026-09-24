import { redirect } from "@sveltejs/kit";
import { store } from "$lib/server/runtime";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	const [latest] = store.diaryDays();
	if (latest) redirect(303, `/diary/${latest}`);
	return {};
};
