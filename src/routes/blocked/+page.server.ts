import { isOpen } from "$lib/server/ashi/legs/blockers";
import { md } from "$lib/server/markdown";
import { store } from "$lib/server/runtime";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	const all = Object.values(store.blockers())
		.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
		.map((b) => ({ ...b, remedyHtml: md(b.remedy) }));
	return {
		open: all.filter(isOpen),
		closed: all.filter((b) => !isOpen(b)).slice(0, 30),
	};
};

export const actions: Actions = {
	/** 権限を足した・気にしない。同じことがまた起きたら、また知らせる */
	resolve: async ({ request }) => {
		const key = String((await request.formData()).get("key") ?? "");
		const all = store.blockers();
		const b = all[key];
		if (b && isOpen(b))
			store.saveBlockers({
				...all,
				[key]: { ...b, resolvedAt: new Date().toISOString() },
			});
		return {};
	},
};
