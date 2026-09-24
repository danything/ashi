import { expect, test } from "bun:test";
import { md } from "../src/lib/server/markdown.ts";

test("生の HTML は字にし、危ないリンクと外の画像は出さない", () => {
	const out = md(
		"<script>alert(1)</script>\n\n[a](javascript:alert(1)) [b](https://example.com) ![x](https://t.example/p.png)",
	);
	expect(out).not.toContain("<script>");
	expect(out).toContain("&lt;script&gt;");
	expect(out).not.toContain("javascript:");
	expect(out).toContain('href="https://example.com"');
	expect(out).not.toContain("<img");
});
