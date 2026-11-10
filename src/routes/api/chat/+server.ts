import { error, json } from "@sveltejs/kit";

import type { Turn } from "#lib/server/ashi/head/head.ts";
import { chat, ChatRefused } from "#lib/server/ashi/legs/chat.ts";
import { unsaidFixes } from "#lib/server/ashi/legs/guard.ts";
import { md } from "#lib/server/markdown.ts";
import { getHead, getTools, store } from "#lib/server/runtime.ts";

import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, locals }) => {
  const body = (await request.json().catch(() => null)) as {
    history?: Turn[];
    message?: string;
  } | null;
  if (!body || typeof body.message !== "string") error(400, "message が要る");
  try {
    const r = await chat(
      { store, head: getHead(), tools: getTools() },
      locals.user?.name ?? "?",
      Array.isArray(body.history) ? body.history : [],
      body.message,
    );
    return json({
      reply: r.reply,
      html: md(r.reply),
      added: r.added,
      usd: r.usd,
      // この返事で伝えた分を引いた、まだ伝えていない訂正の数
      unsaid: unsaidFixes(store.walk().ownerCorrections),
    });
  } catch (e) {
    if (e instanceof ChatRefused) error(429, e.message);
    console.error(e);
    error(
      502,
      e instanceof Error
        ? `頭が答えられなかった: ${e.message}`
        : "頭が答えられなかった",
    );
  }
};
