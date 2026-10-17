import { describe, expect, test } from "bun:test";
import { writeXlsx } from "hucre/xlsx";
import {
	SHEET_MAX_UNZIPPED,
	sheetKind,
	summarizeRows,
	unzippedSize,
} from "../src/lib/server/ashi/legs/sheets.ts";
import { fetchUrlTool } from "../src/lib/server/ashi/legs/tools.ts";

const XLSX =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const resolve = async () => ["93.184.216.34"];
const cfg = { fetch: { maxBytes: 200_000, timeoutMs: 1000 } };

const book = async () =>
	new Uint8Array(
		await writeXlsx({
			sheets: [
				{
					name: "実験2",
					rows: [
						["参加者", "条件", "評価"],
						["p1", "A", 3],
						["p2", "B", 5],
						["p3", "A", 4],
					],
				},
			],
		}),
	);

const serve = (bytes: Uint8Array | string, type: string) =>
	(async () =>
		new Response(bytes as BodyInit, {
			headers: { "content-type": type },
		})) as unknown as typeof fetch;

describe("表計算のファイルを読む", () => {
	test("xlsx をシートごとに、列名・先頭の行・列ごとの件数と平均の要約にする", async () => {
		const out = await fetchUrlTool(cfg, {
			fetch: serve(await book(), XLSX),
			resolve,
		}).run({ url: "https://osf.io/download/abc" });
		expect(out).toContain("## 実験2(4 行 × 3 列");
		expect(out).toContain("参加者\t条件\t評価");
		expect(out).toContain("- 評価: 3 件(数値 3、平均 4.000)");
	});

	test("展開すると大きすぎる zip は読まない", async () => {
		const bytes = await book();
		// 目次の 1 件目の「展開後の大きさ」を書き換える
		const view = new DataView(bytes.buffer);
		for (let i = bytes.byteLength - 22; i >= 0; i--) {
			if (view.getUint32(i, true) !== 0x06054b50) continue;
			const cd = view.getUint32(i + 16, true);
			view.setUint32(cd + 24, SHEET_MAX_UNZIPPED + 1, true);
			break;
		}
		expect(unzippedSize(bytes)).toBeGreaterThan(SHEET_MAX_UNZIPPED);
		const out = await fetchUrlTool(cfg, {
			fetch: serve(bytes, XLSX),
			resolve,
		}).run({
			url: "https://osf.io/download/abc",
		});
		expect(out).toContain("上限");
		expect(out).not.toContain("参加者");
		expect(unzippedSize(new Uint8Array([1, 2, 3]))).toBeUndefined();
	});

	test("csv は要約と元の文字の先頭を返す", async () => {
		const out = await fetchUrlTool(cfg, {
			fetch: serve("a,b\n1,2\n3,4\n", "text/csv"),
			resolve,
		}).run({ url: "https://example.com/data.csv" });
		expect(out).toContain("## CSV(3 行 × 2 列");
		expect(out).toContain("- b: 2 件(数値 2、平均 3.000)");
		expect(out).toContain("## 元の文字(先頭)");
	});

	test("種類は content-type か拡張子で見分ける", () => {
		expect(sheetKind(XLSX, new URL("https://x.example/f"))).toBe("xlsx");
		expect(
			sheetKind("application/octet-stream", new URL("https://x.example/a.ods")),
		).toBe("ods");
		expect(sheetKind("text/plain", new URL("https://x.example/a.tsv"))).toBe(
			"csv",
		);
		expect(
			sheetKind("text/html", new URL("https://x.example/a")),
		).toBeUndefined();
		expect(summarizeRows("空", [[null, ""]])).toBe("## 空\n(空)");
	});
});
