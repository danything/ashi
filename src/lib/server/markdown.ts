import { Marked } from "marked";

/**
 * ノート・日記・自己記述の Markdown を HTML に。中身は頭と web から来たものなので、
 * 生の HTML は字として出し、リンクは http(s) と同じサイトの中だけにする。
 */
const esc = (s: string) =>
	s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

const marked = new Marked({
	gfm: true,
	breaks: true,
	renderer: {
		html({ text }) {
			return esc(text);
		},
		link({ href, tokens }) {
			const label = this.parser.parseInline(tokens);
			if (!/^(https?:\/\/|\/(?!\/))/i.test(href)) return label;
			const external = /^https?:/i.test(href);
			return `<a href="${esc(href)}"${external ? ' rel="noopener noreferrer nofollow" target="_blank"' : ""}>${label}</a>`;
		},
		image({ text }) {
			// 外の画像を勝手に読みに行かせない
			return esc(text);
		},
	},
});

export function md(src: string): string {
	return marked.parse(src, { async: false });
}
