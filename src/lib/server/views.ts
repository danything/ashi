import { isOpen } from "$lib/server/ashi/legs/blockers";
import { md } from "$lib/server/markdown";
import { store } from "$lib/server/runtime";

/**
 * 画面の材料。束ねた画面(ノート | 日記、自分 | 持ち主の地図、改善案 | 弾かれたこと)は
 * 2 つ分を並べて見せるので、読み出しをここにまとめて両方の画面から使う。
 * フォームの送り先は元の画面(/owner・/blocked)の actions のまま
 */

export function ownerView() {
	const walk = store.walk();
	const cfg = store.config();
	const states = store.feedStates();
	return {
		feeds: cfg.feeds.map((f) => ({
			...f,
			state: states[f.id],
			requested: walk.crawlRequests.includes(f.id),
		})),
		feedMinHours: cfg.feedMinHours,
		html: md(store.owner()),
		sources: store.sources().reverse(),
		pending: store.materialCount() - walk.profiledMaterials,
		profileEvery: cfg.profileEvery,
	};
}

export function blockedView() {
	const all = Object.values(store.blockers())
		.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
		.map((b) => ({ ...b, remedyHtml: md(b.remedy) }));
	return {
		open: all.filter(isOpen),
		closed: all.filter((b) => !isOpen(b)).slice(0, 30),
	};
}

/** 日記。day が無いか形が違えば、いちばん新しい日 */
export function diaryView(day: string | null) {
	const days = store.diaryDays();
	const pick =
		day && /^\d{4}-\d{2}-\d{2}$/.test(day) && days.includes(day)
			? day
			: days[0];
	return {
		day: pick ?? null,
		days,
		html: pick ? md(store.diary(pick) ?? "") : "",
	};
}
