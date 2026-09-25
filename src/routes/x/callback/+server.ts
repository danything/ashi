import { error, redirect } from "@sveltejs/kit";
import { type XPending, xFinishLogin } from "$lib/server/ashi/legs/x";
import { unseal } from "$lib/server/auth";
import { store } from "$lib/server/runtime";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, cookies }) => {
	const pending = unseal<XPending>(cookies.get("ashi_x_login"));
	cookies.delete("ashi_x_login", { path: "/x" });
	if (url.searchParams.get("error"))
		error(400, `X での許可が中断されました: ${url.searchParams.get("error")}`);
	const code = url.searchParams.get("code");
	if (!code) error(400, "認可コードがありません");
	if (!pending || url.searchParams.get("state") !== pending.state)
		error(400, "state が一致しません。もう一度つないでください");
	const account = await xFinishLogin(
		store,
		code,
		`${url.origin}/x/callback`,
		pending,
		new Date(),
	);
	store.log("x-connected", { username: account.username });
	redirect(303, "/x");
};
