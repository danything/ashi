import { redirect } from "@sveltejs/kit";
import { authConfigured, safeTo } from "$lib/server/auth";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals, url }) => {
	const to = safeTo(url.searchParams.get("to"));
	if (locals.user) redirect(303, to);
	return { to, configured: authConfigured() };
};
