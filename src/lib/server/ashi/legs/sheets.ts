/**
 * 表計算のファイル(xlsx・ods・csv)を、列のある表として読む(hucre)。OSF にあった生データの xlsx が
 * 1 行に詰まった文字列で返ってきて集計できず、材料が手元にあるのに「未確認」で終わった
 * (Ashi の改善案、2026-10-13)。読むだけで、書かない。
 *
 * 知らない人のファイルを読むので、zip を展開する前に、目次(central directory)で中身の合計の大きさを
 * 確かめる(zip bomb を避ける)。hucre には展開の上限が無い
 */

type Cell = string | number | boolean | Date | null;

/** 取ってくる表計算のファイルの上限(圧縮されたまま) */
export const SHEET_MAX_BYTES = 20_000_000;
/** zip の中身を展開したときの合計の上限 */
export const SHEET_MAX_UNZIPPED = 150_000_000;
const MAX_SHEETS = 3;
const PREVIEW_ROWS = 15;
const MAX_ROWS = 50_000;
const CELL_CHARS = 60;

export type SheetKind = "xlsx" | "ods" | "csv";

/** 表計算のファイルか。xlsx・ods は中身のバイト列で、csv は文字で読む */
export function sheetKind(type: string, url: URL): SheetKind | undefined {
	const t = type.toLowerCase();
	const ext = url.pathname
		.toLowerCase()
		.match(/\.(xlsx|xlsm|ods|csv|tsv)$/)?.[1];
	if (
		/spreadsheetml|ms-excel\.sheet/.test(t) ||
		ext === "xlsx" ||
		ext === "xlsm"
	)
		return "xlsx";
	if (/opendocument\.spreadsheet/.test(t) || ext === "ods") return "ods";
	if (
		/text\/(csv|tab-separated-values)/.test(t) ||
		ext === "csv" ||
		ext === "tsv"
	)
		return "csv";
	return undefined;
}

/**
 * zip の目次から、中身を展開したときの合計の大きさを出す。zip でない・目次が読めない・zip64 なら
 * undefined(読まない)
 */
export function unzippedSize(bytes: Uint8Array): number | undefined {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	// 目次の終わり(EOCD)は末尾 22〜65,557 バイトの中にある
	const min = Math.max(0, bytes.byteLength - 65_557);
	let eocd = -1;
	for (let i = bytes.byteLength - 22; i >= min; i--)
		if (view.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	if (eocd < 0) return undefined;
	const entries = view.getUint16(eocd + 10, true);
	const cdOffset = view.getUint32(eocd + 16, true);
	if (entries === 0xffff || cdOffset === 0xffffffff) return undefined;
	let p = cdOffset;
	let total = 0;
	for (let n = 0; n < entries; n++) {
		if (p + 46 > bytes.byteLength || view.getUint32(p, true) !== 0x02014b50)
			return undefined;
		const size = view.getUint32(p + 24, true);
		if (size === 0xffffffff) return undefined;
		total += size;
		p +=
			46 +
			view.getUint16(p + 28, true) +
			view.getUint16(p + 30, true) +
			view.getUint16(p + 32, true);
	}
	return total;
}

const cellText = (v: Cell) => {
	if (v === null || v === undefined) return "";
	const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
	return s.length > CELL_CHARS ? `${s.slice(0, CELL_CHARS)}…` : s;
};

/** 1 枚の表の要約: 行数・列名・先頭の行・列ごとの件数と数値の平均 */
export function summarizeRows(name: string, rows: Cell[][]): string {
	const body = rows.filter((r) => r.some((c) => c !== null && c !== ""));
	if (body.length === 0) return `## ${name}\n(空)`;
	const width = Math.max(...body.map((r) => r.length));
	const header = body[0] ?? [];
	const data = body.slice(1);
	const stats = Array.from({ length: width }, (_, i) => {
		const vals = data.map((r) => r[i]).filter((c) => c !== null && c !== "");
		const nums = vals.filter((c): c is number => typeof c === "number");
		const label = cellText(header[i] ?? null) || `列${i + 1}`;
		const mean = nums.length
			? (nums.reduce((a, x) => a + x, 0) / nums.length).toPrecision(4)
			: "";
		return `- ${label}: ${vals.length} 件${nums.length ? `(数値 ${nums.length}、平均 ${mean})` : ""}`;
	});
	const preview = body
		.slice(0, PREVIEW_ROWS)
		.map((r) => r.map((c) => cellText(c ?? null)).join("\t"))
		.join("\n");
	return `## ${name}(${body.length} 行 × ${width} 列。1 行目を列名とみなした)\n\n先頭の ${Math.min(PREVIEW_ROWS, body.length)} 行(タブ区切り):\n${preview}\n\n列ごと:\n${stats.join("\n")}`;
}

/** 表計算のファイルを読み、シートごとの要約を返す。読めない・大きすぎるときは理由の文 */
export async function sheetToText(
	kind: SheetKind,
	input: Uint8Array | string,
): Promise<string> {
	if (kind === "csv") {
		const { parseCsv } = await import("hucre/csv");
		const rows = parseCsv(String(input), { typeInference: true }).slice(
			0,
			MAX_ROWS,
		);
		return summarizeRows("CSV", rows);
	}
	const bytes = input instanceof Uint8Array ? input : new Uint8Array();
	if (bytes.byteLength > SHEET_MAX_BYTES)
		return `(表のファイルが ${bytes.byteLength} バイトで、上限 ${SHEET_MAX_BYTES} を超えるので読まない)`;
	const unzipped = unzippedSize(bytes);
	if (unzipped === undefined)
		return "(表のファイルの中身の大きさが確かめられないので読まない)";
	if (unzipped > SHEET_MAX_UNZIPPED)
		return `(表のファイルを展開すると ${unzipped} バイトになり、上限 ${SHEET_MAX_UNZIPPED} を超えるので読まない)`;
	const opts = {
		sheets: Array.from({ length: MAX_SHEETS }, (_, i) => i),
		maxRows: MAX_ROWS,
	};
	const wb =
		kind === "ods"
			? await (await import("hucre/ods")).readOds(bytes, opts)
			: await (await import("hucre/xlsx")).readXlsx(bytes, opts);
	if (wb.sheets.length === 0) return "(シートが無い)";
	return wb.sheets
		.slice(0, MAX_SHEETS)
		.map((s) => summarizeRows(s.name, s.rows as Cell[][]))
		.join("\n\n");
}
