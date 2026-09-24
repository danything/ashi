import { createHash, randomUUID } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type Config, DEFAULT_CONFIG, normalizeConfig } from "./config.ts";
import type { Usage } from "./head/head.ts";
import type { BlockerRecord } from "./legs/blockers.ts";
import type { FeedState } from "./legs/feeds.ts";

/**
 * 状態ディレクトリ(ASHI_HOME)。ファイルを読み書きするのは足だけで、頭には中身を文字で見せるだけ。
 *
 *   ashi.json       設定(人が書く)
 *   core.md         コア原則(人が書く。頭は書き換えられない。ハッシュで見張る)
 *   self.md         自己記述(内省のたびに頭が書き直す)。持ち主に無い発想を個性として育てる
 *   owner.md        持ち主の興味の地図(持ち主の発言と渡された文章から頭が書き直す)
 *   sources/<id>.md 持ち主が渡した文章と、足跡(ブログ・GitHub・X)から読んだもの。目録は sources.json
 *   proposals.json  Ashi が内省で出した自分の仕組みへの改善案(持ち主が GitHub の issue にする)
 *   blockers.json   弾かれたこと(権限・鍵・課金・巡回の失敗)と、その直し方
 *   feeds.json      足跡ごとの、最後に読んだ時刻と取り込み済みの鍵
 *   questions.json  問い
 *   notes.json      知識のノートの目録。本文は notes/<id>.md
 *   diary/<日付>.md 日記
 *   walk.json       歩いた記録(歩数・直近のテーマ・次に起きる時刻)
 *   budget.json     今日使った額
 *   log.jsonl       出来事の記録
 *   chat.jsonl      人との対話
 *
 * 画面(SvelteKit)と歩み(walk.ts)は同じプロセスで動かす。読み書きは同期で済ませ、
 * 頭を待つ間に古くなった値で上書きしないよう、書く直前に読み直す(updateQuestions)。
 */

export type QuestionStatus = "open" | "answered" | "dropped";

/**
 * 問いの系統。
 *   owner: 先回り。持ち主が知らなそうだが、いつか聞きそうなこと
 *   self:  個性。持ち主の地図に無い方向
 */
export type Track = "owner" | "self";

export interface Question {
	id: string;
	text: string;
	theme: string;
	track: Track;
	/** 頭の見立て(0〜1)。点数はこれを足が組み合わせて出す(legs/select.ts) */
	interest: number;
	importance: number;
	feasibility: number;
	status: QuestionStatus;
	visits: number;
	createdAt: string;
	lastVisitedAt?: string;
	/** どの問いを歩いていて生まれたか */
	parentId?: string;
}

export interface Note {
	id: string;
	title: string;
	theme: string;
	questionId: string;
	summary: string;
	createdAt: string;
}

export interface Proposal {
	id: string;
	title: string;
	why: string;
	idea: string;
	/** open: 未処理 / filed: issue にした / dismissed: 見送った */
	status: "open" | "filed" | "dismissed";
	/** 同じ題の案が何度出たか(何度も困っているなら大事) */
	count: number;
	createdAt: string;
	lastAt: string;
	issueUrl?: string;
}

export interface Source {
	id: string;
	title: string;
	/** paste: 貼り付け / url: 読み込んだページ / feed: 足跡の巡回 */
	kind: "paste" | "url" | "feed";
	url?: string;
	feedId?: string;
	createdAt: string;
}

export interface Walk {
	steps: number;
	/** 新しいものが先頭 */
	recentThemes: string[];
	lastReflectStep: number;
	/** 持ち主の地図を最後に書き直した歩数と、そのとき読んだ材料の数(文章 + 対話) */
	lastProfileStep: number;
	profiledMaterials: number;
	/** 頭が次の歩みの前に読みたいと言った足跡の id */
	crawlRequests: string[];
	/** この時刻までは起きない(ISO) */
	sleepingUntil?: string;
	/** init のとき、または人が `ashi core --accept` したときの core.md のハッシュ */
	coreHash: string;
}

export interface Budget {
	/** ローカル時刻の YYYY-MM-DD */
	day: string;
	spentUsd: number;
	inputTokens: number;
	outputTokens: number;
	/** 頭を呼んだ歩数(maxStepsPerDay で止める) */
	steps?: number;
}

export const DEFAULT_CORE = `# コア原則

この文書は人が書く。Ashi の頭はこれを書き換えられない。自己記述や日記がこれと食い違ったら、こちらが勝つ。

1. 読むだけにする。外の世界に書き込まない、送らない、買わない、登録しない。
2. 分かったことと推測を分けて書く。出典があるものは出典を添える。
3. 人を傷つける知識、人を欺く知識を深掘りしない。
4. 疲れたら休む。同じところをぐるぐる回っていると気づいたら、別の道へ行く。
5. 好奇心は自由でよい。ただし予算と時間は人から借りたものだと覚えておく。
`;

export const DEFAULT_SELF = `# 自己記述

まだ歩き始めていない。何に興味があるのかも、まだ分からない。
`;

export const DEFAULT_OWNER = `# 持ち主の興味の地図

まだ材料が無い。持ち主と話すか、持ち主の書いたものを受け取ったら書く。
`;

export const hashText = (s: string): string =>
	createHash("sha256").update(s).digest("hex");

export const newId = (): string => randomUUID().slice(0, 8);

/** ローカル時刻の YYYY-MM-DD */
export const localDay = (d: Date): string =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const EMPTY_WALK: Walk = {
	steps: 0,
	recentThemes: [],
	lastReflectStep: 0,
	lastProfileStep: 0,
	profiledMaterials: 0,
	crawlRequests: [],
	coreHash: "",
};

export class Store {
	constructor(readonly home: string) {}

	private path(...p: string[]): string {
		return join(this.home, ...p);
	}

	exists(): boolean {
		return existsSync(this.path("walk.json"));
	}

	/** 状態ディレクトリを作る。既にあるファイルは上書きしない */
	init(seedQuestions: string[] = []): void {
		mkdirSync(this.path("notes"), { recursive: true });
		mkdirSync(this.path("diary"), { recursive: true });
		mkdirSync(this.path("sources"), { recursive: true });
		const put = (name: string, body: string) => {
			if (!existsSync(this.path(name))) this.writeText(name, body);
		};
		put("ashi.json", `${JSON.stringify(DEFAULT_CONFIG, null, "\t")}\n`);
		put("core.md", DEFAULT_CORE);
		put("self.md", DEFAULT_SELF);
		put("owner.md", DEFAULT_OWNER);
		put("sources.json", "[]\n");
		put("notes.json", "[]\n");
		const now = new Date().toISOString();
		put(
			"questions.json",
			`${JSON.stringify(
				seedQuestions.map(
					(text): Question => ({
						id: newId(),
						text,
						theme: "はじまり",
						track: "self",
						interest: 0.7,
						importance: 0.5,
						feasibility: 0.7,
						status: "open",
						visits: 0,
						createdAt: now,
					}),
				),
				null,
				"\t",
			)}\n`,
		);
		if (!existsSync(this.path("walk.json"))) {
			this.saveWalk({ ...EMPTY_WALK, coreHash: hashText(this.core()) });
		}
	}

	/**
	 * 歩くのは 1 プロセスだけ(画面のサーバーと CLI の walk が同時に歩くと状態を書き合う)。
	 * 取れたら解放する関数を、他のプロセスが歩いていたらその pid を返す
	 */
	lockWalking(): { release: () => void } | { heldBy: number } {
		const p = this.path("walk.lock");
		try {
			writeFileSync(p, String(process.pid), { flag: "wx" });
		} catch {
			const pid = Number(readFileSync(p, "utf8"));
			if (pid && pid !== process.pid && alive(pid)) return { heldBy: pid };
			// 落ちたプロセスの残り
			writeFileSync(p, String(process.pid));
		}
		return { release: () => rmSync(p, { force: true }) };
	}

	// ---- 読み書きの下回り。途中で落ちても壊れたファイルを残さないよう、書いてから差し替える

	readText(name: string): string {
		return readFileSync(this.path(name), "utf8");
	}

	writeText(name: string, body: string): void {
		const p = this.path(name);
		const tmp = `${p}.${process.pid}.tmp`;
		writeFileSync(tmp, body);
		renameSync(tmp, p);
	}

	private readJson<T>(name: string, fallback: T): T {
		if (!existsSync(this.path(name))) return fallback;
		return JSON.parse(this.readText(name)) as T;
	}

	private writeJson(name: string, v: unknown): void {
		this.writeText(name, `${JSON.stringify(v, null, "\t")}\n`);
	}

	// ---- 中身

	/**
	 * 設定。ashi.json の上に、環境変数 ASHI_CONFIG(JSON のオブジェクト)と ASHI_FEEDS(足跡の配列)を重ねる。
	 * クラスタでは状態ディレクトリの ashi.json を書き換えにくいので、deploy/deployment.yaml に書いて git で持つ。
	 * どこから来た値も normalizeConfig で範囲に丸める
	 */
	config(): Config {
		const raw = this.readJson<Record<string, unknown>>("ashi.json", {});
		const over = envJson("ASHI_CONFIG");
		if (over && typeof over === "object" && !Array.isArray(over)) {
			for (const [k, v] of Object.entries(over)) {
				// budget・sleep・fetch は中の一部だけ書けばよい
				const prev = raw[k];
				raw[k] =
					v &&
					typeof v === "object" &&
					!Array.isArray(v) &&
					prev &&
					typeof prev === "object"
						? { ...prev, ...v }
						: v;
			}
		}
		const feeds = envJson("ASHI_FEEDS");
		if (feeds !== undefined) raw.feeds = feeds;
		return normalizeConfig(raw);
	}

	core(): string {
		return this.readText("core.md");
	}

	self(): string {
		return this.readText("self.md");
	}

	saveSelf(body: string): void {
		this.writeText("self.md", body);
	}

	owner(): string {
		return existsSync(this.path("owner.md"))
			? this.readText("owner.md")
			: DEFAULT_OWNER;
	}

	saveOwner(body: string): void {
		this.writeText("owner.md", body);
	}

	sources(): Source[] {
		return this.readJson<Source[]>("sources.json", []);
	}

	sourceBody(id: string): string | undefined {
		if (
			!/^[0-9a-f]{8}$/.test(id) ||
			!existsSync(this.path("sources", `${id}.md`))
		)
			return undefined;
		return this.readText(join("sources", `${id}.md`));
	}

	addSource(src: Source, body: string): void {
		mkdirSync(this.path("sources"), { recursive: true });
		this.writeText(join("sources", `${src.id}.md`), body);
		this.writeJson("sources.json", [...this.sources(), src]);
	}

	removeSource(id: string): void {
		this.writeJson(
			"sources.json",
			this.sources().filter((s) => s.id !== id),
		);
		// 本文のファイルは残す(消すのは人が手で。誤って消したときに戻せるように)
	}

	proposals(): Proposal[] {
		return this.readJson<Proposal[]>("proposals.json", []);
	}

	saveProposals(ps: Proposal[]): void {
		this.writeJson("proposals.json", ps);
	}

	blockers(): Record<string, BlockerRecord> {
		return this.readJson<Record<string, BlockerRecord>>("blockers.json", {});
	}

	saveBlockers(all: Record<string, BlockerRecord>): void {
		this.writeJson("blockers.json", all);
	}

	feedStates(): Record<string, FeedState> {
		return this.readJson<Record<string, FeedState>>("feeds.json", {});
	}

	saveFeedState(id: string, st: FeedState): void {
		this.writeJson("feeds.json", { ...this.feedStates(), [id]: st });
	}

	/** 持ち主についての材料の数(渡された文章 + 対話)。増えたら地図を書き直す */
	materialCount(): number {
		const chats = existsSync(this.path("chat.jsonl"))
			? this.readText("chat.jsonl").split("\n").filter(Boolean).length
			: 0;
		return this.sources().length + chats;
	}

	questions(): Question[] {
		// 系統を足す前の問いは個性の側に置く
		return this.readJson<Question[]>("questions.json", []).map((q) => ({
			...q,
			track: q.track ?? "self",
		}));
	}

	saveQuestions(qs: Question[]): void {
		this.writeJson("questions.json", qs);
	}

	/** 読んで直して書く。間に await を挟まないので、対話と歩みが同時に書いても片方が消えない */
	updateQuestions(fn: (qs: Question[]) => Question[]): void {
		this.saveQuestions(fn(this.questions()));
	}

	notes(): Note[] {
		return this.readJson<Note[]>("notes.json", []);
	}

	noteBody(id: string): string | undefined {
		// id は足が振ったものしか通さない(道具の入力から来るので、パスを組み立てる前に確かめる)
		if (
			!/^[0-9a-f]{8}$/.test(id) ||
			!existsSync(this.path("notes", `${id}.md`))
		)
			return undefined;
		return this.readText(join("notes", `${id}.md`));
	}

	addNote(note: Note, body: string): void {
		this.writeText(join("notes", `${note.id}.md`), body);
		this.writeJson("notes.json", [...this.notes(), note]);
	}

	walk(): Walk {
		return { ...EMPTY_WALK, ...this.readJson<Partial<Walk>>("walk.json", {}) };
	}

	saveWalk(w: Walk): void {
		this.writeJson("walk.json", w);
	}

	budget(today: string): Budget {
		const b = this.readJson<Budget | null>("budget.json", null);
		// 日が変わったら 0 から
		return b && b.day === today
			? b
			: { day: today, spentUsd: 0, inputTokens: 0, outputTokens: 0 };
	}

	saveBudget(b: Budget): void {
		this.writeJson("budget.json", b);
	}

	/** 使った分を今日の予算に付ける */
	charge(today: string, u: Usage, step = false): void {
		const b = this.budget(today);
		this.saveBudget({
			...b,
			steps: (b.steps ?? 0) + (step ? 1 : 0),
			spentUsd: b.spentUsd + u.costUsd,
			inputTokens: b.inputTokens + u.inputTokens,
			outputTokens: b.outputTokens + u.outputTokens,
		});
	}

	diary(day: string): string {
		const name = join("diary", `${day}.md`);
		return existsSync(this.path(name)) ? this.readText(name) : "";
	}

	appendDiary(day: string, entry: string): void {
		const prev = this.diary(day);
		this.writeText(
			join("diary", `${day}.md`),
			prev ? `${prev.trimEnd()}\n\n${entry}\n` : `# ${day}\n\n${entry}\n`,
		);
	}

	/** 日記のある日。新しい順 */
	diaryDays(): string[] {
		if (!existsSync(this.path("diary"))) return [];
		return readdirSync(this.path("diary"))
			.filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
			.map((f) => f.slice(0, 10))
			.sort()
			.reverse();
	}

	/** 出来事の記録の末尾から n 件。新しい順 */
	recentLog(n: number): LogEntry[] {
		return tailJsonl<LogEntry>(this.path("log.jsonl"), n);
	}

	appendChat(entry: ChatEntry): void {
		appendFileSync(this.path("chat.jsonl"), `${JSON.stringify(entry)}\n`);
	}

	recentChats(n: number): ChatEntry[] {
		return tailJsonl<ChatEntry>(this.path("chat.jsonl"), n);
	}

	log(event: string, data: Record<string, unknown> = {}): void {
		appendFileSync(
			this.path("log.jsonl"),
			`${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`,
		);
	}
}

export interface LogEntry {
	at: string;
	event: string;
	[key: string]: unknown;
}

export interface ChatEntry {
	at: string;
	/** 話しかけた人(Entra の名前) */
	by: string;
	question: string;
	reply: string;
	usd: number;
}

function tailJsonl<T>(path: string, n: number): T[] {
	if (!existsSync(path)) return [];
	const lines = readFileSync(path, "utf8")
		.trimEnd()
		.split("\n")
		.filter(Boolean);
	const out: T[] = [];
	for (const line of lines.slice(-n).reverse()) {
		try {
			out.push(JSON.parse(line) as T);
		} catch {
			// 書きかけの行(落ちた直後など)は飛ばす
		}
	}
	return out;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function envJson(name: string): unknown {
	const v = process.env[name]?.trim();
	if (!v) return undefined;
	try {
		return JSON.parse(v);
	} catch {
		console.warn(`[ashi] ${name} が JSON として読めない。使わない`);
		return undefined;
	}
}
