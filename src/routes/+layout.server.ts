import { openBlockers } from "$lib/server/ashi/legs/blockers";
import { store } from "$lib/server/runtime";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user,
	/** 弾かれていることの数。全画面の上に出す */
	blocked: locals.user ? openBlockers(store).length : 0,
	/** 開いている改善案の数。ナビに出す */
	proposals: locals.user
		? store.proposals().filter((p) => p.status === "open").length
		: 0,
});
