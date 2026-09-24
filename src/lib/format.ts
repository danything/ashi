/** 画面の表示。日付は YYYY/MM/DD HH:mm(ローカル) */
export function when(iso: string | undefined | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const usd = (n: number): string => `$${n.toFixed(n < 1 ? 3 : 2)}`;

export const TRACK_LABEL = { owner: "先回り", self: "個性" } as const;
