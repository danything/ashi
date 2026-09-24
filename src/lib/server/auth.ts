import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

/**
 * Entra ID(職場アカウント)でのログイン。認可コード + PKCE で、取るのは id_token だけ。
 *
 * 通すのは ENTRA_TENANT_ID のテナントの人で、ENTRA_ROLE(既定 admin)のアプリロールを持つ人だけ。
 * doany.io の他のアプリと同じく、誰が使えるかはエンタープライズ アプリケーションのロール割り当てで決める
 * (テナントに P1 が無いのでユーザー単位)。ENTRA_ROLE を空にするとテナントの全員が入れる。
 *
 * セッションは DB を持たず、署名した Cookie に名前と期限だけを入れる(SESSION_SECRET で HMAC)。
 */

const env = (k: string) => process.env[k]?.trim() || undefined;

export interface SessionUser {
	sub: string;
	name: string;
	email: string | null;
}

export const SESSION_COOKIE = "ashi_session";
export const LOGIN_COOKIE = "ashi_login";
const SESSION_HOURS = 12;

export function authConfigured(): boolean {
	return Boolean(
		env("ENTRA_TENANT_ID") &&
			env("ENTRA_CLIENT_ID") &&
			env("ENTRA_CLIENT_SECRET") &&
			secret(),
	);
}

function secret(): string | undefined {
	const s = env("SESSION_SECRET");
	return s && s.length >= 32 ? s : undefined;
}

function mustSecret(): string {
	const s = secret();
	if (!s) throw new Error("SESSION_SECRET が無いか短すぎる(32 文字以上)");
	return s;
}

const base = () =>
	env("ENTRA_BASE") ??
	`https://login.microsoftonline.com/${env("ENTRA_TENANT_ID")}/oauth2/v2.0`;

const b64url = (b: Buffer) => b.toString("base64url");
const sign = (data: string) =>
	createHmac("sha256", mustSecret()).update(data).digest("base64url");

function verify(data: string, sig: string): boolean {
	const a = Buffer.from(sign(data));
	const b = Buffer.from(sig);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** 署名付きの小さな値(セッションとログイン途中の状態) */
export function seal(v: unknown): string {
	const data = b64url(Buffer.from(JSON.stringify(v)));
	return `${data}.${sign(data)}`;
}

export function unseal<T>(token: string | undefined): T | null {
	if (!token || !secret()) return null;
	const [data, sig] = token.split(".");
	if (!data || !sig || !verify(data, sig)) return null;
	try {
		return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as T;
	} catch {
		return null;
	}
}

interface Sealed extends SessionUser {
	exp: number;
}

export function sessionToken(
	u: SessionUser,
	now = Date.now(),
): { token: string; expires: Date } {
	const exp = now + SESSION_HOURS * 3600_000;
	return {
		token: seal({ ...u, exp } satisfies Sealed),
		expires: new Date(exp),
	};
}

export function resolveSession(
	token: string | undefined,
	now = Date.now(),
): SessionUser | null {
	const s = unseal<Sealed>(token);
	if (
		!s ||
		typeof s.exp !== "number" ||
		s.exp < now ||
		typeof s.sub !== "string"
	)
		return null;
	return { sub: s.sub, name: s.name, email: s.email };
}

/** ログインの途中で Cookie に預けるもの */
export interface Pending {
	state: string;
	verifier: string;
	nonce: string;
	to: string;
}

export function startLogin(
	redirectUri: string,
	to: string,
): { url: string; pending: Pending } {
	const pending: Pending = {
		state: b64url(randomBytes(24)),
		verifier: b64url(randomBytes(48)),
		nonce: b64url(randomBytes(24)),
		to,
	};
	const params = new URLSearchParams({
		client_id: env("ENTRA_CLIENT_ID") ?? "",
		response_type: "code",
		redirect_uri: redirectUri,
		response_mode: "query",
		scope: "openid profile email",
		state: pending.state,
		nonce: pending.nonce,
		code_challenge: b64url(
			createHash("sha256").update(pending.verifier).digest(),
		),
		code_challenge_method: "S256",
	});
	return { url: `${base()}/authorize?${params}`, pending };
}

/** id_token の中身。token endpoint から TLS で直接受け取ったものにだけ使う(署名は見ない) */
export function claimsOf(jwt: string): Record<string, unknown> {
	const [, body] = jwt.split(".");
	if (!body) throw new Error("id_token の形が違う");
	return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
		string,
		unknown
	>;
}

/** id_token の中身を確かめて、通してよい人なら SessionUser を返す */
export function admit(
	claims: Record<string, unknown>,
	nonce: string,
	now = Date.now(),
): SessionUser {
	const tenant = env("ENTRA_TENANT_ID");
	const role =
		process.env.ENTRA_ROLE === undefined
			? "admin"
			: process.env.ENTRA_ROLE.trim();
	if (claims.aud !== env("ENTRA_CLIENT_ID"))
		throw new AuthError("このアプリ宛ての id_token ではない");
	if (claims.tid !== tenant) throw new AuthError("このテナントの人ではない");
	if (claims.nonce !== nonce)
		throw new AuthError("nonce が一致しない。もう一度ログインしてください");
	if (typeof claims.exp !== "number" || claims.exp * 1000 < now)
		throw new AuthError("id_token の期限が切れている");
	const roles = Array.isArray(claims.roles) ? claims.roles : [];
	if (role && !roles.includes(role))
		throw new AuthError(`アプリロール ${role} が割り当てられていない`);
	const sub =
		typeof claims.oid === "string" ? claims.oid : String(claims.sub ?? "");
	if (!sub) throw new AuthError("利用者を識別できない");
	const email =
		typeof claims.email === "string"
			? claims.email
			: typeof claims.preferred_username === "string"
				? claims.preferred_username
				: null;
	return {
		sub,
		name: typeof claims.name === "string" ? claims.name : (email ?? sub),
		email,
	};
}

export class AuthError extends Error {}

export async function finishLogin(
	code: string,
	redirectUri: string,
	pending: Pending,
): Promise<SessionUser> {
	const res = await fetch(`${base()}/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env("ENTRA_CLIENT_ID") ?? "",
			client_secret: env("ENTRA_CLIENT_SECRET") ?? "",
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			code_verifier: pending.verifier,
		}),
		signal: AbortSignal.timeout(15_000),
	});
	const body = (await res.json().catch(() => ({}))) as {
		id_token?: string;
		error?: string;
		error_description?: string;
	};
	if (!res.ok || !body.id_token) {
		throw new AuthError(
			`トークン交換に失敗: ${body.error_description ?? body.error ?? res.status}`,
		);
	}
	return admit(claimsOf(body.id_token), pending.nonce);
}

/** ログイン後の戻り先。同じサイトの中だけ */
export function safeTo(to: string | null | undefined): string {
	return to?.startsWith("/") && !to.startsWith("//") && !to.startsWith("/\\")
		? to
		: "/";
}
