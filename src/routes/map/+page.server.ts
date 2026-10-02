import { ownerHandles } from "#lib/server/ashi/legs/guard.ts";
import { buildThoughtMap } from "#lib/server/ashi/map.ts";
import { store } from "#lib/server/runtime.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
	map: buildThoughtMap(
		store.questions(),
		store.notes(),
		store.bridgeIdeas(),
		ownerHandles(store.config()),
	),
});
