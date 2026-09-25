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
	build: {
		// いちばん大きいのは /map の 3D の図(3d-force-graph と three.js、約 1.3 MB)。開いたときだけ読む
		// 動的 import なので、ほかの画面は重くならない。これを超えるものが出たら警告で止める
		chunkSizeWarningLimit: 1500,
		rolldownOptions: {
			// プラグインにかかった時間の知らせ。警告ではなく目安なので出さない
			checks: { pluginTimings: false },
		},
	},
	server: {
		host: true,
	},
}));
