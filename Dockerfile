FROM oven/bun:1.4.2-slim AS base
WORKDIR /usr/src/app
EXPOSE 3000

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
ENV NODE_ENV=production ASHI_HOME=/data
RUN mkdir -p /data && chown bun:bun /data
USER bun
COPY --from=builder --chown=bun:bun /usr/src/app/package.json ./package.json
COPY --from=builder --chown=bun:bun /usr/src/app/build ./build
VOLUME /data
CMD ["bun", "build/index.js"]
