import { describe, expect, test } from "bun:test";
import { buildThoughtMap } from "../src/lib/server/ashi/map.ts";
import { q } from "./helpers.ts";

describe("つながりの地図", () => {
	const qs = [
		q({
			id: "s1",
			track: "self",
			theme: "労働時間",
			createdAt: "2026-09-25T01:00:00Z",
			source: "x",
			via: "5yuim",
			text: "つながらない権利は時間外の連絡をどう扱うか",
		}),
		q({
			id: "o1",
			track: "owner",
			theme: "稼働表",
			createdAt: "2026-09-25T02:00:00Z",
			parentId: "s1",
			source: "explore",
			text: "稼働表は偽装請負の証拠になるか",
		}),
		q({
			id: "s2",
			track: "self",
			theme: "労働時間",
			createdAt: "2026-09-25T03:00:00Z",
			source: "chat",
			text: "つながらない権利は時間外の連絡を減らしたか",
		}),
	];
	const notes = [
		{
			id: "n1",
			title: "稼働表のノート",
			theme: "稼働表",
			questionId: "o1",
			summary: "",
			createdAt: "2026-09-25T02:30:00Z",
		},
	];
	const map = buildThoughtMap(qs, notes, [], ["5yuim"]);
	const kinds = (a: string, b: string) =>
		map.links
			.filter((l) => l.source === a && l.target === b)
			.map((l) => l.kind);

	test("個性から先回りへ生まれた問いは橋渡しの線", () => {
		expect(kinds("q:s1", "q:o1")).toEqual(["bridge"]);
	});
	test("歩いてノートを書いた線", () => {
		expect(kinds("q:o1", "n:n1")).toEqual(["note"]);
	});
	test("持ち主の X と対話は、持ち主の点から出どころを通ってつながる", () => {
		expect(kinds("o:x:5yuim", "q:s1")).toEqual(["origin"]);
		expect(kinds("owner", "o:x:5yuim")).toEqual(["origin"]);
		expect(kinds("owner", "o:chat")).toEqual(["origin"]);
	});
	test("文字の近い問いはゆるい連想の線で、遅いほうの時刻", () => {
		const near = map.links.find((l) => l.kind === "near");
		expect(near?.source).toBe("q:s1");
		expect(near?.target).toBe("q:s2");
		expect(near?.at).toBe("2026-09-25T03:00:00Z");
	});
});
