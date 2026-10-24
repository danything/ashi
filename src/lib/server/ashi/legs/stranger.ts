import { addUsage, type Head, noUsage, type Usage } from "../head/head.ts";
import {
  DIALOGUE_FINAL_SCHEMA,
  DIALOGUE_REPLY_SCHEMA,
  dialoguePrompt,
  dialogueSystem,
  STRANGER_SCHEMA,
  strangerPrompt,
  strangerSystem,
} from "../prompts.ts";
import type { Dialogue, Question, Store } from "../state.ts";
import {
  acceptClaims,
  acceptNewQuestions,
  claimQuestions,
  markedClaims,
  mergeClaims,
  patternHits,
  type RawQuestion,
  trimOpenQuestions,
} from "./guard.ts";
import { carriedPhrases, SWEEPING, sweepingSentences } from "./style.ts";

/**
 * よそ者との対話。内省のたびに、持ち主の地図を知らない別のモデルと短く話し、個性の問いの種にする。
 *
 * 個性(self)の問いは「持ち主の地図から一歩外れた方向」を頼んでいたが、実際には出どころの分かるもの
 * 全部が持ち主の関心から派生していた(2026-09-25、ownerPull 24 / 24)。X の来客がよその関心を持ち込む
 * はずだったが、話しかけてきたのは持ち主だけだった。人が新しい発想を得るのは、批評されたときより
 * 違うことに興味がある人と話したときなので、採点役ではなく話し相手を置く。
 *
 * - 相手は頭と別のモデル(既定 Sonnet 5.5)。賢さより癖が違うことが効く
 * - 相手の関心の分野は足がさいころで選ぶ(毎回同じ人格に固まらないように)
 * - 相手には持ち主の地図も自己記述も見せない。先に話すのも相手(Ashi が話題を持ち主の側へ寄せないように)
 * - 決めるのは Ashi。会話から出した問いも、ほかの問いと同じガードレールを通す
 * - 生まれた問いの出どころは stranger(via にモデルと分野)。ownerPull で効き目を測る
 */

/**
 * 会話のおよそこの割合で、足がさいころで Ashi の言い切った文を 1 つ選び、確かめる事実を頭に取り出させる。
 * 確かめの問いは自分で「確かめていない」と言った発言からしか生まれず、疑わずに言い切った誤りは
 * どこにも引っかからなかった(Ashi の改善案、2026-10-05)
 */
export const SPOT_RATE = 1 / 3;

/** 言い切った文の候補(問いかけ・短い文・「確かめていない」と断った文は除く)から 1 つ */
export function spotSentence(
  texts: string[],
  rng: () => number,
): string | undefined {
  const cands = texts
    .flatMap((t) => t.split(/(?<=[。!!])|\n/))
    .map((x) => x.trim())
    .filter(
      (x) =>
        x.length >= 20 && !/[??]$/.test(x) && markedClaims([x]).length === 0,
    );
  if (cands.length === 0) return undefined;
  return cands[Math.floor(rng() * cands.length)]?.slice(0, 200);
}

export const STRANGER_FIELDS = [
  "生物学",
  "古代史",
  "音楽",
  "数学",
  "料理",
  "天文学",
  "建築",
  "言語学",
  "民俗学",
  "地質学",
  "園芸",
  "鉄道",
  "囲碁や将棋",
  "医学史",
  "海洋",
  "昆虫",
  "服飾",
  "気象",
  "考古学",
  "映画",
] as const;

/** 直前のこの回数の会話の分野は、次のさいころで選ばない */
export const FIELD_REST = 2;

const MAX_TURN_CHARS = 1200;

export interface StrangerTalk {
  dialogue: Dialogue;
  usage: Usage;
}

export async function talkWithStranger(opts: {
  store: Store;
  head: Head;
  stranger: Head;
  turns: number;
  now: Date;
  rng?: () => number;
}): Promise<StrangerTalk> {
  const { store, head, stranger, now } = opts;
  const rng = opts.rng ?? Math.random;
  // 直前の FIELD_REST 回の分野は、さいころから外す。同じ分野が続くと借りが一つの話題に偏り、前の会話の
  // 言い回しも持ち込みやすかった(10-18 に囲碁や将棋が 2 回続いた。Ashi の改善案、2026-10-17)
  const recent = store.recentDialogues(FIELD_REST).map((d) => d.field);
  const pool = STRANGER_FIELDS.filter((f) => !recent.includes(f));
  const fields = pool.length ? pool : STRANGER_FIELDS;
  const field = fields[Math.floor(rng() * fields.length)] ?? STRANGER_FIELDS[0];
  const turns: Dialogue["turns"] = [];
  let usage: Usage = noUsage();
  const add = (u: Usage) => {
    usage = addUsage(usage, u);
  };
  const text = (v: unknown) =>
    typeof v === "string" ? v.trim().slice(0, MAX_TURN_CHARS) : "";

  let final: {
    new_questions?: RawQuestion[];
    takeaway?: unknown;
    unverified?: unknown;
    accepted?: unknown;
    about_self?: unknown;
    pushed_back?: unknown;
    retracted?: unknown;
    spot_check?: unknown;
  } = {};
  const n = Math.max(1, opts.turns);
  const spotting = rng() < SPOT_RATE;
  let spot: string | undefined;
  let sweeping: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = await stranger.think<{ reply: string }>({
      task: "stranger",
      system: strangerSystem(field),
      prompt: strangerPrompt(turns),
      schema: STRANGER_SCHEMA,
    });
    add(s.usage);
    const said = text(s.output.reply);
    if (!said) break;
    turns.push({ by: "stranger", text: said });

    const last = i === n - 1;
    const mine = turns.filter((t) => t.by === "ashi").map((t) => t.text);
    if (last && spotting) spot = spotSentence(mine, rng);
    // 締めでは、総称・全称・確度の語を含む自分の発言も見せる
    if (last) sweeping = sweepingSentences(mine);
    const a = await head.think<{
      reply: string;
      new_questions?: RawQuestion[];
      takeaway?: unknown;
      unverified?: unknown;
      accepted?: unknown;
      about_self?: unknown;
      pushed_back?: unknown;
      retracted?: unknown;
      spot_check?: unknown;
    }>({
      task: last ? "dialogue-final" : "dialogue",
      system: dialogueSystem(store.core(), store.self()),
      // 締めでは、足が印で拾った文を見せ、何の文かを頭に分けさせる
      prompt: dialoguePrompt(
        turns,
        last,
        last ? markedClaims(mine) : [],
        spot,
        sweeping,
      ),
      schema: last ? DIALOGUE_FINAL_SCHEMA : DIALOGUE_REPLY_SCHEMA,
    });
    add(a.usage);
    const reply = text(a.output.reply);
    if (reply) turns.push({ by: "ashi", text: reply });
    if (last) final = a.output;
  }

  let added: string[] = [];
  const raw = (Array.isArray(final.new_questions) ? final.new_questions : [])
    // よそ者から生まれた問いは個性の側
    .map((q) => ({ ...q, track: "self" }));
  // 会話の中で記憶だけで言ったことも、X と同じく確かめる問いにして控える(Ashi の改善案、2026-09-26。
  // 「記憶で言います」と断ったまま確かめない、が起きていた)
  // 足が印で拾うのは、頭が判定した後に出た締めの発言だけ。それより前の文は締めで頭に分けさせた
  const closing = turns.at(-1)?.by === "ashi" ? [turns.at(-1)?.text ?? ""] : [];
  const claims = mergeClaims(
    acceptClaims(final.unverified),
    markedClaims(closing),
  );
  // 相手に押し返されたこと・さいころで選んだ文の事実も、どちらが正しいかを確かめる
  const pushedBack = acceptClaims(final.pushed_back);
  // 相手の言葉で引っ込めた主張と、きっかけの相手の主張(Ashi の改善案、2026-10-17)
  const retracted = (Array.isArray(final.retracted) ? final.retracted : [])
    .filter(
      (r): r is { mine: string; because: string } =>
        typeof r?.mine === "string" &&
        typeof r?.because === "string" &&
        r.mine.trim() !== "" &&
        r.because.trim() !== "",
    )
    .slice(0, 3)
    .map((r): NonNullable<Dialogue["retracted"]>[number] => {
      // 相手の観察の強さで引っ込めたのか、ただ合わせたのかを後で数えるため、相手が何を添えていたかも残す
      // (Ashi の改善案、2026-10-17)
      const b = (r as { backing?: unknown }).backing;
      const backing =
        b === "出典" || b === "確度" || b === "なし" ? b : undefined;
      return {
        mine: r.mine.trim().slice(0, 200),
        because: r.because.trim().slice(0, 200),
        ...(backing ? { backing } : {}),
      };
    });
  const spotClaim = text(final.spot_check).slice(0, 200);
  if (
    raw.length ||
    claims.length ||
    pushedBack.length ||
    spotClaim ||
    retracted.length
  ) {
    const cfg = store.config();
    const from = {
      source: "stranger" as const,
      via: `${stranger.name}:${field}`,
    };
    store.updateQuestions((qs) => {
      const got = acceptNewQuestions(raw, qs, cfg, undefined, now, from);
      const checks: Question[] = [];
      const put = (raws: RawQuestion[], kind?: Question["verifyKind"]) => {
        if (raws.length === 0) return;
        checks.push(
          ...acceptNewQuestions(
            raws,
            [...qs, ...got, ...checks],
            { ...cfg, maxNewQuestions: raws.length },
            undefined,
            now,
            from,
          ).map((q) => ({
            ...q,
            verify: true,
            ...(kind ? { verifyKind: kind } : {}),
          })),
        );
      };
      // 総称・全称・確度の語を含む主張には印を付ける(あとで誤りの率を印の有無で数える)
      put(
        claimQuestions(
          claims.filter((c) => !SWEEPING.test(c)),
          `${field}の話し相手に`,
        ),
      );
      put(
        claimQuestions(
          claims.filter((c) => SWEEPING.test(c)),
          `${field}の話し相手に`,
        ),
        "sweeping",
      );
      put(
        claimQuestions(
          pushedBack,
          "",
          `${field}の話し相手に言って、押し返されたこと`,
        ),
        "pushback",
      );
      for (const r of retracted) {
        put(
          claimQuestions(
            [r.mine],
            "",
            `${field}の話し相手の言葉で引っ込めた、自分の主張`,
          ),
          "retract",
        );
        put(
          claimQuestions(
            [r.because],
            "",
            `${field}の話し相手の言葉。これを受けて「${r.mine.slice(0, 40)}」を引っ込めた`,
          ),
          "retract",
        );
      }
      if (spotClaim)
        put(
          claimQuestions(
            [spotClaim],
            "",
            `${field}の話し相手に言い切ったこと。足がさいころで選んだ`,
          ),
          "spot",
        );
      added = [...got, ...checks].map((q) => q.text);
      return trimOpenQuestions([...qs, ...got, ...checks], cfg);
    });
  }
  const accepted = acceptClaims(final.accepted);
  const aboutSelf = acceptClaims(final.about_self);
  // 自己記述と、直前 24 時間の別のよそ者との会話の自分の返事から、言い回しを持ち込んでいないか
  const dayAgo = now.getTime() - 86400e3;
  const carried = carriedPhrases(
    turns.filter((t) => t.by === "ashi").map((t) => t.text),
    [
      { label: "自己記述", text: store.self() },
      ...store
        .recentDialogues(5)
        .filter((d) => Date.parse(d.at) >= dayAgo)
        .map((d) => ({
          label: `${d.field}の会話(${d.at.slice(5, 16).replace("T", " ")})`,
          text: d.turns
            .filter((t) => t.by === "ashi")
            .map((t) => t.text)
            .join("\n"),
        })),
    ],
  );
  const dialogue: Dialogue = {
    at: now.toISOString(),
    model: stranger.name,
    field,
    turns,
    added,
    takeaway: text(final.takeaway).slice(0, 300),
    ...(accepted.length ? { accepted } : {}),
    ...(aboutSelf.length ? { aboutSelf } : {}),
    ...(pushedBack.length ? { pushedBack } : {}),
    ...(retracted.length ? { retracted } : {}),
    ...(carried.length ? { carried } : {}),
    ...(sweeping.length ? { sweeping } : {}),
    ...(spot ? { spot: { sentence: spot, claim: spotClaim } } : {}),
    patterns: patternHits(turns, store.walk().selfPatterns ?? []),
  };
  store.appendDialogue(dialogue);
  store.log("stranger", { field, model: stranger.name, added });
  return { dialogue, usage };
}
