import {
	addUsage,
	type Blockage,
	type Head,
	HeadAccessError,
	HeadError,
	noUsage,
	type Tool,
	type Usage,
} from "../head/head.ts";
import {
	EXPLORE_SCHEMA,
	type ExploreAnswer,
	explorePrompt,
	type Material,
	PROFILE_SCHEMA,
	type ProfileAnswer,
	profilePrompt,
	REFLECT_SCHEMA,
	type ReflectAnswer,
	recentConversationsText,
	reflectPrompt,
	SEED_SCHEMA,
	type SeedAnswer,
	seedPrompt,
	system,
	type WalkContext,
} from "../prompts.ts";
import { hashText, localDay, newId, type Store, type Track } from "../state.ts";
import { latestBaseline, measureBaseline } from "./baseline.ts";
import { raiseBlocker, resolveBlockers, webhookNotify } from "./blockers.ts";
import { crawlRequested, feedStatus } from "./feeds.ts";
import {
	acceptIntentions,
	acceptNewQuestions,
	acceptPatterns,
	acceptProposals,
	acceptSearched,
	acceptSelf,
	acceptSelfChanges,
	addBridgeIdeas,
	allowance,
	applyMerges,
	blindComparison,
	clampSleep,
	markPromised,
	missedPromises,
	nextMidnight,
	ownerHandles,
	ownerPull,
	selfEvolution,
	similarPairs,
	strangerLanding,
	trimOpenQuestions,
	unit,
	walkTrail,
} from "./guard.ts";
import { restingThemes, SEEDING, selectQuestion } from "./select.ts";
import { talkWithStranger } from "./stranger.ts";
import type { GetDeps } from "./tools.ts";
import {
	canPost,
	canReply,
	looksUnrelated,
	postToX,
	xBlockage,
	xLength,
} from "./x.ts";

/**
 * 足の 1 歩。状態を読み、行き先を選び、頭に考えさせ、ガードレールを通して書き戻し、休む。
 * 1 歩の中の順番: (頭が前の歩みで頼んだ足跡の巡回) → (持ち主の地図の書き直し) → 問いを歩く or 問いを探す → (内省)
 */

/** 自己記述を渡さずに歩くとき、自己記述の欄に置く文 */
const BLIND_SELF =
	"(この歩みでは、足が自己記述を渡していない。自分がどういう者かを思い出さずに、問いとコア原則だけで歩く。対照のための歩み)";

export interface Legs {
	store: Store;
	head: Head;
	tools: Tool[];
	now?: () => Date;
	rng?: () => number;
	/** 足跡を読むときの通信(テストで差し替える) */
	net?: GetDeps;
	env?: Record<string, string | undefined>;
	/** 弾かれたことの知らせ先(既定は NOTIFY_WEBHOOK_URL) */
	notify?: (text: string) => Promise<void>;
	/** よそ者の話し相手(頭と別のモデル)。無ければ話さない */
	stranger?: Head;
}

/** 頭が知らせてきた「弾かれた」を、形を確かめて 1 歩 3 件まで */
export function reportedBlocks(v: unknown): Blockage[] {
	if (!Array.isArray(v)) return [];
	return v
		.filter(
			(x): x is { target: string; reason: string; needed: string } =>
				typeof x?.target === "string" &&
				x.target.trim() !== "" &&
				typeof x.needed === "string",
		)
		.slice(0, 3)
		.map((x) => {
			const target = x.target.trim().slice(0, 100);
			return {
				key: `report:${target.toLowerCase()}`,
				title: `${target} に入れなかった`,
				detail: String(x.reason ?? "").slice(0, 500),
				remedy: x.needed.slice(0, 1000),
			};
		});
}

/** 頭の crawl を受け取る形に。id の照合と間隔の下限は巡回するときに足が見る */
export const crawlIds = (v: unknown): string[] =>
	Array.isArray(v)
		? v.filter((x): x is string => typeof x === "string").slice(0, 10)
		: [];

export type StepOutcome =
	| {
			kind: "walked";
			questionId: string;
			reason: "score" | "detour" | "echo" | "verify" | "promised";
			noteId: string;
			profiled: boolean;
			reflected: boolean;
			wakeAt: Date;
	  }
	| {
			kind: "seeded";
			/** 探させた系統 */
			track: Track;
			added: number;
			profiled: boolean;
			reflected: boolean;
			wakeAt: Date;
	  }
	| { kind: "asleep"; wakeAt: Date }
	/** usd: 今日の予算を使い切った / steps: 今日の歩数の上限に来た */
	| { kind: "broke"; reason: "usd" | "steps"; wakeAt: Date }
	| { kind: "failed"; error: string; wakeAt: Date }
	/** core.md が人の承認なしに変わった。人が `ashi core --accept` するまで歩かない */
	| { kind: "core-changed" };

/** 疲れがこれ以上なら、内省の順番を待たずに立ち止まる */
const TIRED = 0.8;
/** 地図を書くときに読む材料の上限(文字) */
const MATERIAL_CHARS = 60_000;

/** 持ち主の材料。新しいものから上限まで、古い順に並べ直して渡す */
export function gatherMaterials(store: Store): Material[] {
	const chats: Material[] = store
		.recentChats(200)
		.map((c) => ({ kind: "chat" as const, title: c.at, body: c.question }));
	const sources: Material[] = store
		.sources()
		.slice(-30)
		.reverse()
		.map((s) => ({
			kind: "source" as const,
			title: s.title,
			body: (store.sourceBody(s.id) ?? "").slice(0, 8_000),
		}));
	const out: Material[] = [];
	let total = 0;
	// 文章と対話を交互に取り、片方で上限を使い切らない
	for (let i = 0; i < Math.max(chats.length, sources.length); i++) {
		for (const m of [sources[i], chats[i]]) {
			if (!m || total + m.body.length > MATERIAL_CHARS) continue;
			out.push(m);
			total += m.body.length;
		}
	}
	return out.reverse();
}

export async function step(legs: Legs): Promise<StepOutcome> {
	const { store, head } = legs;
	const now = legs.now?.() ?? new Date();
	const rng = legs.rng ?? Math.random;
	const notify = legs.notify ?? webhookNotify;
	const cfg = store.config();
	const walk = store.walk();
	const core = store.core();

	if (hashText(core) !== walk.coreHash) {
		store.log("core-changed");
		return { kind: "core-changed" };
	}
	if (walk.sleepingUntil && new Date(walk.sleepingUntil) > now) {
		return { kind: "asleep", wakeAt: new Date(walk.sleepingUntil) };
	}

	const today = localDay(now);
	let left = allowance(store.budget(today), cfg);
	const sleepUntil = (wakeAt: Date) => {
		store.saveWalk({ ...store.walk(), sleepingUntil: wakeAt.toISOString() });
		return wakeAt;
	};
	if (left <= 0) {
		store.log("broke", { spentUsd: store.budget(today).spentUsd });
		return {
			kind: "broke",
			reason: "usd",
			wakeAt: sleepUntil(nextMidnight(now)),
		};
	}
	if ((store.budget(today).steps ?? 0) >= cfg.maxStepsPerDay) {
		store.log("broke", { steps: cfg.maxStepsPerDay });
		return {
			kind: "broke",
			reason: "steps",
			wakeAt: sleepUntil(nextMidnight(now)),
		};
	}

	// 前の歩みで頭が読みたいと言った足跡を読む(GET だけ。頭は呼ばないので予算は使わない)
	if (walk.crawlRequests.length > 0) {
		store.saveWalk({ ...store.walk(), crawlRequests: [] });
		await crawlRequested(
			store,
			walk.crawlRequests,
			now,
			legs.net,
			legs.env,
			notify,
		);
	}

	// 読み取り専用の道具しか頭に渡さない
	const tools = legs.tools.filter((t) => t.readOnly === true);
	let spent = noUsage();
	// 頭が答えたら、頭の側で弾かれていたこと(鍵・課金)は片づいている
	let thought = false;
	const charge = (u: Usage) => {
		thought = true;
		spent = addUsage(spent, u);
		left -= u.costUsd;
		resolveBlockers(store, "head:", now);
	};
	const sys = () => system(core, store.self(), store.owner());
	const minutes = (m: number) => new Date(now.getTime() + m * 60_000);

	try {
		// 持ち主の材料が増えていたら、順番が来たとき(初めてなら今すぐ)地図を書き直す
		let profiled = false;
		const materials = store.materialCount();
		if (
			materials > walk.profiledMaterials &&
			(walk.lastProfileStep === 0 ||
				walk.steps - walk.lastProfileStep >= cfg.profileEvery)
		) {
			const { output, usage } = await head.think<ProfileAnswer>({
				task: "profile",
				system: sys(),
				prompt: profilePrompt(gatherMaterials(store), store.questions()),
				schema: PROFILE_SCHEMA,
				maxCostUsd: left,
			});
			charge(usage);
			const owner = acceptSelf(output.owner, 8000);
			if (owner) store.saveOwner(owner);
			// 地図から出た問いは先回りの系統に固定する
			const raw = (output.new_questions ?? []).map((q) => ({
				...q,
				track: "owner",
			}));
			let added = 0;
			store.updateQuestions((qs) => {
				const got = acceptNewQuestions(raw, qs, cfg, undefined, now, {
					source: "profile",
				});
				added = got.length;
				return trimOpenQuestions([...qs, ...got], cfg);
			});
			store.saveWalk({
				...store.walk(),
				lastProfileStep: Math.max(1, walk.steps),
				profiledMaterials: materials,
			});
			store.log("profiled", {
				ownerUpdated: Boolean(owner),
				added,
				usd: usage.costUsd,
			});
			profiled = true;
		}

		const questions = store.questions();
		const pick =
			left > 0
				? selectQuestion(questions, walk.recentThemes, cfg, rng, now)
				: null;
		const choice = pick && "question" in pick ? pick : null;
		const resting = restingThemes(walk.recentThemes, cfg);
		const ctx = (): WalkContext => ({
			notes: store.notes(),
			questions: store.questions(),
			feeds: feedStatus(store, now),
			intentions: store.walk().intentions ?? [],
			bridges: store.bridgeIdeas().slice(-10),
			recentThemes: walk.recentThemes.filter((t) => t !== SEEDING),
			resting,
			maxOpenPerTheme: cfg.maxOpenPerTheme,
		});
		let outcome: StepOutcome;
		let tiredness = 0;

		if (left <= 0) {
			// 地図を書いたところで予算が尽きた
			outcome = { kind: "broke", reason: "usd", wakeAt: nextMidnight(now) };
		} else if (!choice) {
			// さいころで決めた系統に歩ける問いが無い(尽きた、または同じテーマが続いて休ませている)。
			// その系統の問いを頭に出させる
			const track = pick && "seed" in pick ? pick.seed : "self";
			const { output, usage } = await head.think<SeedAnswer>({
				task: "seed",
				system: sys(),
				prompt: seedPrompt(track, ctx()),
				schema: SEED_SCHEMA,
				maxCostUsd: left,
			});
			charge(usage);
			let added: string[] = [];
			store.updateQuestions((qs) => {
				// 頭が別の系統を付けてきても、探させた系統に揃える
				const raw = (output.new_questions ?? []).map((q) => ({ ...q, track }));
				let got = acceptNewQuestions(raw, qs, cfg, undefined, now, {
					source: "seed",
				});
				// 休ませているテーマは、頭がまた出してきても受け取らない
				got = got.filter((q) => !resting.includes(q.theme));
				added = got.map((q) => q.text);
				return trimOpenQuestions([...qs, ...got], cfg);
			});
			// 問いを考えただけの歩みも 1 歩。テーマの連続はここで切れる
			store.saveWalk({
				...store.walk(),
				steps: walk.steps + 1,
				recentThemes: [SEEDING, ...walk.recentThemes].slice(0, 20),
				crawlRequests: crawlIds(output.crawl),
			});
			store.log("seeded", { track, added, usd: usage.costUsd });
			tiredness = unit(output.tiredness);
			outcome = {
				kind: "seeded",
				track,
				added: added.length,
				profiled,
				reflected: false,
				wakeAt: minutes(clampSleep(output.sleep_minutes, cfg)),
			};
		} else {
			const q = choice.question;
			// 個性の系統を selfBlindEvery 回歩くごとに 1 回、自己記述を渡さずに歩く(対照のため)。
			// 見つけた型が世界の側のものか、自己記述が探させたものかを、内省でノートを並べて見比べる
			const selfWalks =
				(store.walk().selfWalks ?? 0) + (q.track === "self" ? 1 : 0);
			const blind =
				q.track === "self" &&
				cfg.selfBlindEvery > 0 &&
				selfWalks % cfg.selfBlindEvery === 0;
			if (q.track === "self") store.saveWalk({ ...store.walk(), selfWalks });
			const { output, usage } = await head.think<ExploreAnswer>({
				task: "explore",
				system: blind ? system(core, BLIND_SELF, store.owner()) : sys(),
				prompt: explorePrompt(q, choice.reason, ctx()),
				schema: EXPLORE_SCHEMA,
				tools,
				allowWeb: cfg.allowWeb,
				maxToolRounds: cfg.maxToolRounds,
				maxCostUsd: left,
			});
			charge(usage);

			const noteId = newId();
			const title = String(output.title || q.text).slice(0, 200);
			const summary = String(output.summary ?? "").slice(0, 500);
			store.addNote(
				{
					id: noteId,
					title,
					theme: q.theme,
					questionId: q.id,
					summary,
					createdAt: now.toISOString(),
					...(blind ? { blind: true } : {}),
				},
				`# ${title}\n\n問い: ${q.text}\n\n${String(output.findings ?? "").trim()}\n`,
			);
			let added: string[] = [];
			let bridged: string[] = [];
			const searched = acceptSearched(output.searched);
			const missed = output.found === "none" && output.answered !== true;
			let parked = false;
			store.updateQuestions((qs) => {
				const updated = qs.map((x) => {
					if (x.id !== q.id) return x;
					// 見つからなかった回数を数え、上限に達したら未測定の棚へ(同じ所をぐるぐる探さない)
					const misses = (x.misses ?? 0) + (missed ? 1 : 0);
					parked = output.answered !== true && misses >= cfg.missesToPark;
					// 歩いたら、次の一歩の約束の印は消す(約束は果たした)
					const { promised: _promised, ...rest } = x;
					return {
						...rest,
						visits: x.visits + 1,
						lastVisitedAt: now.toISOString(),
						misses,
						searchedWhere: [
							...new Set([...(x.searchedWhere ?? []), ...searched]),
						].slice(-20),
						status:
							output.answered === true
								? ("answered" as const)
								: parked
									? ("parked" as const)
									: x.status,
					};
				});
				const got = acceptNewQuestions(
					output.new_questions,
					updated,
					cfg,
					q.id,
					now,
					{ source: "explore" },
				);
				added = got.map((a) => a.text);
				// 個性の問いから生まれた先回りの問い = 個性で得た見方を持ち主の側へ持ち帰ったもの
				if (q.track === "self")
					bridged = got.filter((a) => a.track === "owner").map((a) => a.text);
				return trimOpenQuestions([...updated, ...got], cfg);
			});
			addBridgeIdeas(
				store,
				output.bridge_ideas,
				q.track === "self" ? noteId : undefined,
				now,
			);
			store.saveWalk({
				...store.walk(),
				steps: walk.steps + 1,
				recentThemes: [q.theme, ...walk.recentThemes].slice(0, 20),
				crawlRequests: crawlIds(output.crawl),
			});
			// 頭が歩いていて弾かれたと知らせてきたもの。画面の「弾かれたこと」には出すが、通知はしない
			// (有料の論文や判例誌のたびに鳴って、持ち主が手を打てないものばかりだった)
			for (const b of reportedBlocks(output.blocked)) {
				await raiseBlocker(store, "report", b, now, async () => {});
			}
			// X で確かめずに言ったことが違っていたら、その返信に続けて訂正する
			let corrected: string | undefined;
			const correction =
				typeof output.correction === "string" ? output.correction.trim() : "";
			if (
				q.origin &&
				correction &&
				xLength(correction) <= 280 &&
				canReply(store, cfg, now)
			) {
				try {
					await postToX(
						store,
						correction,
						now,
						{
							tweetId: q.origin.replyId,
							conversationId: q.origin.conversationId,
						},
						legs.env ?? process.env,
						legs.net?.fetch ?? fetch,
					);
					corrected = correction;
				} catch (e) {
					await raiseBlocker(store, "x", xBlockage(e), now, notify);
				}
			}
			store.log("walked", {
				questionId: q.id,
				question: q.text,
				...(blind ? { blind: true } : {}),
				theme: q.theme,
				track: q.track,
				corrected,
				reason: choice.reason,
				score: choice.score,
				noteId,
				answered: output.answered === true,
				added,
				bridged,
				found: output.found,
				parked,
				usd: usage.costUsd,
			});
			tiredness = unit(output.tiredness);
			outcome = {
				kind: "walked",
				questionId: q.id,
				reason: choice.reason,
				noteId,
				profiled,
				reflected: false,
				wakeAt: minutes(clampSleep(output.sleep_minutes, cfg)),
			};
		}

		// X のメンションへの返事は歩みとは別(legs/converse.ts、サーバーのタイマーから)

		// 内省。順番が来たか、疲れていたら。予算が残っていなければ次へ持ち越す
		const w = store.walk();
		if (
			outcome.kind !== "broke" &&
			(w.steps - w.lastReflectStep >= cfg.reflectEvery || tiredness >= TIRED) &&
			left > 0
		) {
			// 内省の前に、よそ者と短く話す。話したことを内省の材料にして、自己記述まで届かせる
			// (内省のあとに話していたので、会話から残るのが問いだけだった。Ashi の指摘、2026-09-25)。
			// つまずいても歩み自体は失敗にしない(個性の種が 1 回減るだけ)
			if (legs.stranger && cfg.stranger.enabled) {
				try {
					const talk = await talkWithStranger({
						store,
						head,
						stranger: legs.stranger,
						turns: cfg.stranger.turns,
						now,
						rng,
					});
					charge(talk.usage);
				} catch (e) {
					if (e instanceof HeadError) charge(e.usage);
					store.log("stranger-failed", {
						error: e instanceof Error ? e.message : String(e),
					});
				}
			}
			// 型の当たり率の基準線を測る(1 日 1 回)。つまずいても内省は続ける
			try {
				const b = await measureBaseline({ store, head, now, rng });
				if (b) charge(b.usage);
			} catch (e) {
				if (e instanceof HeadError) charge(e.usage);
				store.log("baseline-failed", {
					error: e instanceof Error ? e.message : String(e),
				});
			}
			const selfBefore = store.self();
			const { output, usage } = await head.think<ReflectAnswer>({
				task: "reflect",
				system: sys(),
				prompt: reflectPrompt(
					store.notes(),
					store.diary(today),
					w.recentThemes.slice(0, 10),
					w.intentions ?? [],
					store.proposals(),
					store.xAccount() && cfg.x.enabled
						? {
								// リンクだけの無関係な返信は材料にしない
								conversations: recentConversationsText(
									store.conversations().map((c) => ({
										...c,
										messages: c.messages.filter(
											(m) => m.byAshi || !looksUnrelated(m.text),
										),
									})),
								),
								canPost: canPost(store, cfg, now),
							}
						: undefined,
					{
						questions: store.questions(),
						similar: similarPairs(store.questions()),
						pull: ownerPull(store.questions(), ownerHandles(cfg)),
					},
					{
						dialogues: store.recentDialogues(3),
						chats: store.recentChats(5),
						stances: (store.walk().stances ?? []).slice(0, 10),
						landing: strangerLanding(store.questions(), ownerHandles(cfg)),
						trail: (() => {
							const t = walkTrail(store.recentLog(300), w.intentions ?? []);
							return {
								...t,
								missing: missedPromises(
									t.promised.filter((id) => !t.kept.includes(id)),
									store.questions(),
									restingThemes(w.recentThemes, cfg),
								),
							};
						})(),
						blind: blindComparison(store.notes(), store.questions()),
						evolution: selfEvolution(store.selfHistory()),
						baseline: latestBaseline(store.recentLog(500)),
					},
				),
				schema: REFLECT_SCHEMA,
				maxCostUsd: left,
			});
			charge(usage);
			const diary =
				typeof output.diary === "string"
					? output.diary.trim().slice(0, 8000)
					: "";
			if (diary)
				store.appendDiary(
					today,
					`## ${now.toTimeString().slice(0, 5)}\n\n${diary}`,
				);
			const self = acceptSelf(output.self);
			if (self) store.saveSelf(self, now);
			const patterns = acceptPatterns(output.patterns);
			if (patterns.length)
				store.saveWalk({ ...store.walk(), selfPatterns: patterns });
			// 自己記述を何が動かしたか。頭の申告と、実際に変わったかを並べて残す。
			// 変わったのに申告が無ければ「申告なし」として数える(申告も頭の自己申告なので)
			const changes = acceptSelfChanges(output.self_changes);
			const changed = Boolean(self) && self?.trim() !== selfBefore.trim();
			if (changed || changes.length)
				store.log("self-changed", {
					changed,
					changes,
					undeclared: changed && changes.length === 0,
				});
			const { proposals, added: proposed } = acceptProposals(
				output.proposals,
				store.proposals(),
				now,
			);
			store.saveProposals(proposals);
			// 頭が決めた統合とテーマの付け替えを、足が状態に当てる
			let merged = 0;
			let renamed = 0;
			let renames = new Map<string, string>();
			store.updateQuestions((qs) => {
				const r = applyMerges(qs, output.merges, output.themes);
				merged = r.merged;
				renamed = r.renamed;
				renames = r.renames;
				return r.questions;
			});
			addBridgeIdeas(store, output.bridge_ideas, undefined, now);
			// 次の一歩は内省のたびに書き直す(古い意図を引きずらない)
			// 付け替えたテーマは歩いた記録にも当てる。古い名前が残ると、同じテーマの歩みが 2 つの名前に
			// 割れて、休ませる判定(themeWindowMax)がしばらく効かなかった(Ashi の指摘、2026-09-25)
			const latest = store.walk();
			store.saveWalk({
				...latest,
				recentThemes: latest.recentThemes.map((t) => renames.get(t) ?? t),
				lastReflectStep: w.steps,
				intentions: acceptIntentions(output.next_steps),
			});
			// 次の一歩に書いた問いに印を付ける(続けて書かれたら、足が先に歩く)
			store.updateQuestions((qs) =>
				markPromised(qs, store.walk().intentions ?? []),
			);
			// 外に出したいこと(1 件まで)。上限と長さは足が見る
			const post = Array.isArray(output.posts) ? output.posts[0] : undefined;
			let posted: string | undefined;
			if (
				post &&
				typeof post.text === "string" &&
				post.text.trim() &&
				canPost(store, cfg, now)
			) {
				const text = post.text.trim();
				if (xLength(text) <= 280) {
					try {
						await postToX(
							store,
							text,
							now,
							undefined,
							legs.env ?? process.env,
							legs.net?.fetch ?? fetch,
						);
						posted = text;
					} catch (e) {
						await raiseBlocker(store, "x", xBlockage(e), now, notify);
					}
				}
			}
			store.log("reflected", {
				selfUpdated: Boolean(self),
				proposed,
				merged,
				renamed,
				posted,
				usd: usage.costUsd,
			});
			if (outcome.kind === "walked" || outcome.kind === "seeded")
				outcome = { ...outcome, reflected: true };
		}

		// 疲れていたら上限まで休む
		if (tiredness >= TIRED && "wakeAt" in outcome) {
			const long = minutes(cfg.sleep.maxMinutes);
			if (outcome.wakeAt < long) outcome = { ...outcome, wakeAt: long };
		}
		if ("wakeAt" in outcome) sleepUntil(outcome.wakeAt);
		return outcome;
	} catch (e) {
		if (e instanceof HeadError) {
			thought = true;
			spent = addUsage(spent, e.usage);
		}
		// サブスクの上限に当たったら、戻るまで何度叩いても同じなので上限まで休む
		let rest = cfg.sleep.minMinutes;
		if (e instanceof HeadAccessError) {
			await raiseBlocker(store, "head", e.blockage, now, notify);
			if (e.blockage.key === "head:subscription-limit")
				rest = cfg.sleep.maxMinutes;
		}
		const error = e instanceof Error ? e.message : String(e);
		store.log("failed", { error, usd: spent.costUsd });
		return {
			kind: "failed",
			error,
			wakeAt: sleepUntil(minutes(rest)),
		};
	} finally {
		// 失敗した歩みの分も必ず数える。頭を呼んだら 1 歩
		store.charge(today, spent, thought);
	}
}

/** 止められるまで歩き続ける。休んでいる間は眠る。wake() で早く起こせる */
export class Walker {
	private wakeEarly: (() => void) | undefined;
	running = false;
	/** いま 1 歩の途中か(頭を待っている間など)。学びのリセットはこの間はしない */
	stepping = false;

	constructor(
		private readonly legs: Legs,
		private readonly onStep?: (o: StepOutcome) => void,
	) {}

	async run(signal?: AbortSignal): Promise<void> {
		this.running = true;
		try {
			while (!signal?.aborted) {
				let o: StepOutcome;
				this.stepping = true;
				try {
					o = await step(this.legs);
				} catch (e) {
					// 状態ファイルが読めない等。1 歩を落としても歩き続ける
					this.legs.store.log("crashed", {
						error: e instanceof Error ? e.message : String(e),
					});
					o = {
						kind: "failed",
						error: String(e),
						wakeAt: new Date(Date.now() + 60_000),
					};
				} finally {
					this.stepping = false;
				}
				this.onStep?.(o);
				if (o.kind === "core-changed") return;
				const ms =
					o.wakeAt.getTime() - (this.legs.now?.() ?? new Date()).getTime();
				if (ms > 0) await this.sleep(ms, signal);
			}
		} finally {
			this.running = false;
		}
	}

	/** 休みを切り上げて、すぐ次の 1 歩へ */
	wake(): void {
		const w = this.legs.store.walk();
		this.legs.store.saveWalk({ ...w, sleepingUntil: undefined });
		this.wakeEarly?.();
	}

	private sleep(ms: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(t);
				signal?.removeEventListener("abort", done);
				this.wakeEarly = undefined;
				resolve();
			};
			// setTimeout の上限(約 24.8 日)を超えないように
			const t = setTimeout(done, Math.min(ms, 2 ** 31 - 1));
			this.wakeEarly = done;
			signal?.addEventListener("abort", done, { once: true });
		});
	}
}
