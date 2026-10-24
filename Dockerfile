FROM oven/bun:1.4.4-slim AS base
WORKDIR /usr/src/app
EXPOSE 3000

# Claude Code の CLI(頭を head: claude-code にしたときに使う)。公式のインストーラーが入れる単体の実行ファイルだけを持っていく。
# 繋ぐのは glibc (libc・libm・libpthread・libdl・librt) だけで、どれも配信用の distroless にある
FROM debian:bookworm-slim AS claude
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
	&& curl -fsSL https://claude.ai/install.sh | bash \
	&& cp -L /root/.local/bin/claude /usr/local/bin/claude

FROM base AS builder
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun i --frozen-lockfile
COPY . .
# 公開のワークフローがコミットを渡す。いまは使っていないが、lgtm と同じ形にしておく
ARG APP_VERSION
RUN bun run build

# 配信用の distroless にはシェルが無いので、要るディレクトリと利用者の登録はここで作っておく。
# 今までどおり uid 1000 (bun) で動かす (PVC の /data の持ち主を変えないため)。distroless の
# /etc/passwd には 1000 が無く、そのままだと HOME が / になって Claude Code の CLI が ~/.claude を
# 書けない (os.userInfo() も引けない) ので、bun を足した passwd / group を作って写す
FROM oven/bun:1.4.4-distroless AS distroless
FROM base AS rootfs
COPY --from=distroless /etc/passwd /etc/group /tmp/etc/
RUN mkdir -p /rootfs/etc /rootfs/data /rootfs/home/bun \
	&& cp /tmp/etc/passwd /tmp/etc/group /rootfs/etc/ \
	&& echo 'bun:x:1000:1000:bun:/home/bun:/sbin/nologin' >> /rootfs/etc/passwd \
	&& echo 'bun:x:1000:' >> /rootfs/etc/group \
	&& chown 1000:1000 /rootfs/data /rootfs/home/bun

# 実行時の依存は無い: dependencies を空にしてあるので、Anthropic の SDK も含めて
# 画面は Vite が、CLI は bun build が build/ に束ねる。node_modules をイメージに載せない
# (新しく足す依存も devDependencies に。dependencies に入れると束ねられず、本番で見つからない)
#
# 配信用は Bun の distroless (シェルもパッケージマネージャも無い)。子プロセスとして起こすのは
# claude と、頭に渡す MCP サーバー (process.execPath = bun) だけで、どちらもシェルを通さずに起こす
FROM distroless
WORKDIR /usr/src/app
# 自動更新はしない(イメージを焼き直して上げる)
ENV NODE_ENV=production ASHI_HOME=/data DISABLE_AUTOUPDATER=1 HOME=/home/bun
COPY --from=rootfs /rootfs/ /
COPY --from=claude /usr/local/bin/claude /usr/local/bin/claude
COPY --from=builder --chown=1000:1000 /usr/src/app/package.json ./package.json
COPY --from=builder --chown=1000:1000 /usr/src/app/build ./build
USER 1000:1000
VOLUME /data
EXPOSE 3000
# 死活の確認は k8s のプローブ (deploy/deployment.yaml の /health) でする
ENTRYPOINT ["/usr/local/bin/bun"]
CMD ["./build"]
