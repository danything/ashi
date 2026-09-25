import { redirect } from "@sveltejs/kit";
import { isOpen } from "$lib/server/ashi/legs/blockers";
import { store } from "$lib/server/runtime";
import type { Actions, PageServerLoad } from "./$types";

/** 弾かれたことは「直すこと」の画面に、改善案と並べた。ここに残すのはフォームの送り先(actions)だけ */
export const load: PageServerLoad = () => redirect(303, "/proposals");

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
