import { score } from "#lib/server/ashi/legs/select.ts";
import { localDay } from "#lib/server/ashi/state.ts";
import {
	isPaused,
	isWalking,
	setPaused,
	store,
	wakeNow,
} from "#lib/server/runtime.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
	const cfg = store.config();
	const questions = store.questions();
	const open = questions.filter((q) => q.status === "open");
	return {
		walk: store.walk(),
		walking: isWalking(),
		paused: isPaused(),
		budget: store.budget(localDay(new Date())),
		cfg: {
			head: cfg.head,
			model: cfg.model,
			dailyUsd: cfg.budget.dailyUsd,
			maxStepsPerDay: cfg.maxStepsPerDay,
			ownerShare: cfg.ownerShare,
		},
		counts: {
			open: open.length,
			owner: open.filter((q) => q.track === "owner").length,
			self: open.filter((q) => q.track === "self").length,
			answered: questions.filter((q) => q.status === "answered").length,
			notes: store.notes().length,
		},
		next: open
			.map((q) => ({ ...q, score: score(q) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, 6),
		notes: store.notes().slice(-6).reverse(),
		log: store.recentLog(12),
	};
};

export const actions: Actions = {
	wake: () => {
		wakeNow();
		return { woke: true };
	},
	/** 費用を抑えるために止める / 再開する */
	pause: ({ locals }) => {
		setPaused(true, locals.user?.name ?? "?");
		return { paused: true };
	},
	resume: ({ locals }) => {
		setPaused(false, locals.user?.name ?? "?");
		return { resumed: true };
	},
};
