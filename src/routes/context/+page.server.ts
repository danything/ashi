import { system } from "$lib/server/ashi/prompts";
import { hashText } from "$lib/server/ashi/state";
import { md } from "$lib/server/markdown";
import { store } from "$lib/server/runtime";
import type { PageServerLoad } from "./$types";

/** 頭が毎回受け取っているもの。コア原則・自己記述・持ち主の地図と、それを束ねた system */
export const load: PageServerLoad = () => {
	const core = store.core();
	return {
		core: md(core),
		coreOk: hashText(core) === store.walk().coreHash,
		self: md(store.self()),
		system: system(core, store.self(), store.owner()),
		config: JSON.stringify(store.config(), null, 2),
	};
};
