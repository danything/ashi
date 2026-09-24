import { error, redirect } from "@sveltejs/kit";
import {
	AuthError,
	finishLogin,
	LOGIN_COOKIE,
	type Pending,
	SESSION_COOKIE,
	sessionToken,
	unseal,
} from "$lib/server/auth";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, cookies }) => {
	const pending = unseal<Pending>(cookies.get(LOGIN_COOKIE));
	cookies.delete(LOGIN_COOKIE, { path: "/auth" });
	if (url.searchParams.get("error"))
		error(
			400,
			`認可が中断されました: ${url.searchParams.get("error_description") ?? url.searchParams.get("error")}`,
		);
	const code = url.searchParams.get("code");
	if (!code) error(400, "認可コードがありません");
	if (!pending || url.searchParams.get("state") !== pending.state)
		error(400, "state が一致しません。もう一度ログインしてください");

	let user: Awaited<ReturnType<typeof finishLogin>>;
	try {
		user = await finishLogin(code, `${url.origin}/auth/callback`, pending);
	} catch (e) {
		if (e instanceof AuthError) error(403, e.message);
		throw e;
	}
	const { token, expires } = sessionToken(user);
	cookies.set(SESSION_COOKIE, token, {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: url.protocol === "https:",
		expires,
	});
	redirect(303, pending.to);
};
