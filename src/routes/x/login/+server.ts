import { error, redirect } from "@sveltejs/kit";
import { xAuthorizeUrl, xConfigured } from "$lib/server/ashi/legs/x";
import { seal } from "$lib/server/auth";
import type { RequestHandler } from "./$types";

/** Ashi の X アカウント(bot)をつなぐ。持ち主がログインした状態で、X には bot のアカウントで入る */
export const GET: RequestHandler = ({ url, cookies }) => {
	if (!xConfigured())
		error(503, "X のアプリ(X_CLIENT_ID・X_CLIENT_SECRET)が設定されていません");
	const { url: to, pending } = xAuthorizeUrl(`${url.origin}/x/callback`);
	cookies.set("ashi_x_login", seal(pending), {
		path: "/x",
		httpOnly: true,
		sameSite: "lax",
		secure: url.protocol === "https:",
		maxAge: 600,
	});
	redirect(303, to);
};
