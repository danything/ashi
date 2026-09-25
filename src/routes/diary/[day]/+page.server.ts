import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

/** 日記はノートの画面に並べた */
export const load: PageServerLoad = ({ params }) =>
	redirect(303, `/notes?day=${encodeURIComponent(params.day)}`);
