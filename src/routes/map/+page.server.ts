import { ownerHandles } from "$lib/server/ashi/legs/guard";
import { buildThoughtMap } from "$lib/server/ashi/map";
import { store } from "$lib/server/runtime";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
	map: buildThoughtMap(
		store.questions(),
		store.notes(),
		store.bridgeIdeas(),
		ownerHandles(store.config()),
	),
});
