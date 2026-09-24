import { type Handle, redirect, type ServerInit } from "@sveltejs/kit";
import {
	authConfigured,
	resolveSession,
	SESSION_COOKIE,
} from "$lib/server/auth";
import { startWalking } from "$lib/server/runtime";

/** 起動時に一度だけ。設定漏れはログの先頭で分かるように */
export const init: ServerInit = () => {
	if (!authConfigured())
		console.warn("ENTRA_* か SESSION_SECRET が空です。誰もログインできません");
	startWalking();
};

/** ログイン無しで開けるのは、ログインの画面と Entra からの戻り、health だけ */
const PUBLIC = /^\/(login|auth\/(login|callback)|health)$/;

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = resolveSession(event.cookies.get(SESSION_COOKIE));
	const { pathname, search } = event.url;
	if (!PUBLIC.test(pathname) && !event.locals.user) {
		const wantsHtml =
			event.request.headers.get("accept")?.includes("text/html") === true;
		if (event.request.method !== "GET" || !wantsHtml)
			return new Response("login required", { status: 401 });
		redirect(302, `/login?to=${encodeURIComponent(pathname + search)}`);
	}
	const response = await resolve(event);
	// 中身は持ち主の頭の中なので、どこにもキャッシュさせない
	response.headers.set("cache-control", "private, no-store");
	return response;
};
