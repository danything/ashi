import { describe, expect, test } from "bun:test";
import { citationConflicts } from "../src/lib/server/ashi/legs/citations.ts";
import { localStamp } from "../src/lib/server/ashi/state.ts";

describe("citationConflicts", () => {
	test("同じ著者を、あるノートは査読前、別のノートは採録と書いていたら出す", () => {
		const got = citationConflicts([
			{ id: "n1", text: "Lee と Novak 2025(米国、査読前)によると……" },
			{
				id: "n2",
				text: "前に査読前と書いたが、Novak の業績一覧では採録が決まっている。",
			},
			{ id: "n3", text: "Novak の話は出てこない別のノート。" },
		]);
		expect(got).toEqual([
			{
				authors: "Novak",
				kind: "status",
				variants: [
					{ label: "査読前", noteIds: ["n1"] },
					{ label: "採録・出版", noteIds: ["n2"] },
				],
			},
		]);
	});

	test("2 人の組で年が食い違えば出す。1 人だけの「ら」や、同じノートで複数の年を挙げたものは出さない", () => {
		const got = citationConflicts([
			{ id: "n1", text: "Lee・Novak 2024 は……" },
			{ id: "n2", text: "Lee と Novak(2025)では……" },
			{ id: "n3", text: "Park ら 2019 と、Park ら 2021" },
			{ id: "n4", text: "Park ら 2020" },
			{ id: "n5", text: "Ortiz・Brandt 2001" },
			{ id: "n6", text: "Ortiz・Brandt 2015" },
		]);
		expect(got).toEqual([
			{
				authors: "Lee・Novak",
				kind: "year",
				variants: [
					{ label: "2024", noteIds: ["n1"] },
					{ label: "2025", noteIds: ["n2"] },
				],
			},
		]);
	});

	test("URL の中の英単語は著者とみなさない", () => {
		expect(
			citationConflicts([
				{
					id: "n1",
					text: "Novak 2025、査読前 https://x.example/Research-preprint",
				},
				{ id: "n2", text: "https://x.example/Research 2024 に採録" },
			]),
		).toEqual([]);
	});
});

test("localStamp は日記の見出しと同じローカル時刻にする", () => {
	const prev = process.env.TZ;
	process.env.TZ = "Asia/Tokyo";
	try {
		expect(localStamp("2026-10-02T17:59:00.000Z")).toBe("2026-10-03 02:59");
	} finally {
		process.env.TZ = prev;
	}
});
