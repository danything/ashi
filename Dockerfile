FROM oven/bun:1.4.2-slim AS base
WORKDIR /usr/src/app
EXPOSE 3000

# Claude Code の CLI(頭を head: claude-code にしたときに使う)。公式のインストーラーが入れる単体の実行ファイルだけを持っていく
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

# 実行時の依存は無い: dependencies を空にしてあるので、Anthropic の SDK も含めて
# 画面は Vite が、CLI は bun build が build/ に束ねる。node_modules をイメージに載せない
FROM base
# 自動更新はしない(イメージを焼き直して上げる)
ENV NODE_ENV=production ASHI_HOME=/data DISABLE_AUTOUPDATER=1
COPY --from=claude /usr/local/bin/claude /usr/local/bin/claude
RUN mkdir -p /data && chown bun:bun /data
USER bun
COPY --from=builder --chown=bun:bun /usr/src/app/package.json ./package.json
COPY --from=builder --chown=bun:bun /usr/src/app/build ./build
VOLUME /data
CMD ["bun", "build/index.js"]
