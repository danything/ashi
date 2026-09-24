import { describe, expect, test } from "bun:test";
import {
	AuthError,
	admit,
	resolveSession,
	safeTo,
	seal,
	sessionToken,
	unseal,
} from "../src/lib/server/auth.ts";

const ok = {
	aud: "client-1",
	tid: "tenant-1",
	nonce: "n",
	exp: Date.now() / 1000 + 600,
	oid: "user-1",
	name: "持ち主",
	preferred_username: "info@doany.io",
	roles: ["admin"],
};

describe("seal", () => {
	test("書き換えられた値は読まない", () => {
		const t = seal({ a: 1 });
		expect(unseal<{ a: number }>(t)).toEqual({ a: 1 });
		const [data, sig] = t.split(".");
		const forged = `${Buffer.from(JSON.stringify({ a: 2 })).toString("base64url")}.${sig}`;
		expect(unseal(forged)).toBeNull();
		expect(unseal(`${data}.x`)).toBeNull();
	});
});

describe("session", () => {
	test("期限が切れたら無効", () => {
		const { token } = sessionToken({ sub: "s", name: "n", email: null }, 0);
		expect(resolveSession(token, 1000)?.sub).toBe("s");
		expect(resolveSession(token, 13 * 3600_000)).toBeNull();
	});
});

describe("admit", () => {
	test("テナント・宛先・nonce・期限・ロールを確かめる", () => {
		expect(admit(ok, "n")).toEqual({
			sub: "user-1",
			name: "持ち主",
			email: "info@doany.io",
		});
		expect(() => admit({ ...ok, tid: "other" }, "n")).toThrow(AuthError);
		expect(() => admit({ ...ok, aud: "other" }, "n")).toThrow(AuthError);
		expect(() => admit(ok, "other")).toThrow("nonce");
		expect(() => admit({ ...ok, exp: 1 }, "n")).toThrow("期限");
		expect(() => admit({ ...ok, roles: [] }, "n")).toThrow("admin");
	});

	test("ENTRA_ROLE を空にするとテナントの全員", () => {
		process.env.ENTRA_ROLE = "";
		try {
			expect(admit({ ...ok, roles: undefined }, "n").sub).toBe("user-1");
		} finally {
			delete process.env.ENTRA_ROLE;
		}
	});
});

describe("safeTo", () => {
	test("同じサイトの中だけ", () => {
		expect(safeTo("/notes")).toBe("/notes");
		expect(safeTo("//evil.example")).toBe("/");
		expect(safeTo("/\\evil.example")).toBe("/");
		expect(safeTo("https://evil.example")).toBe("/");
		expect(safeTo(null)).toBe("/");
	});
});
