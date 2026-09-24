import { error, redirect } from "@sveltejs/kit";
import {
	authConfigured,
	LOGIN_COOKIE,
	safeTo,
	seal,
	startLogin,
} from "$lib/server/auth";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url, cookies }) => {
	if (!authConfigured()) error(503, "Entra ID のログインが設定されていません");
	const { url: to, pending } = startLogin(
		`${url.origin}/auth/callback`,
		safeTo(url.searchParams.get("to")),
	);
	cookies.set(LOGIN_COOKIE, seal(pending), {
		path: "/auth",
		httpOnly: true,
		sameSite: "lax",
		secure: url.protocol === "https:",
		maxAge: 600,
	});
	redirect(303, to);
};
