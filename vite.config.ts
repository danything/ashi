import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { createLogger, defineConfig } from "vite";

/** ビルドの警告は放置しない: 出たら表示したうえで、ビルドの終了コードを失敗にする(開発サーバーでは何もしない) */
function strictLogger() {
	const logger = createLogger();
	const { warn, warnOnce } = logger;
	logger.warn = (msg, opts) => {
		warn(msg, opts);
		process.exitCode = 1;
	};
	logger.warnOnce = (msg, opts) => {
		warnOnce(msg, opts);
		process.exitCode = 1;
	};
	return logger;
}

export default defineConfig(({ command }) => ({
	customLogger: command === "build" ? strictLogger() : undefined,
	plugins: [sveltekit({ adapter: adapter() })],
	css: {
		preprocessorOptions: {
			// Pico の SCSS が古い if() を使っている(Pico 側の話で、こちらでは直せない)
			scss: { silenceDeprecations: ["if-function"] },
		},
	},
	build: {
		rolldownOptions: {
			// プラグインにかかった時間の知らせ。警告ではなく目安なので出さない
			checks: { pluginTimings: false },
		},
	},
	server: {
		host: true,
	},
}));
