# 两个镜像：runner 跑网站（Next.js standalone，体积小）；tools 带全部依赖，用来建表、建账号、导入数据
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1280
RUN pnpm build --webpack

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0 TZ=Asia/Shanghai
RUN useradd -r -u 1001 app && mkdir -p /data/storage && chown app /data/storage
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER app
EXPOSE 3100
CMD ["node", "server.js"]

FROM deps AS tools
COPY . .
ENTRYPOINT ["pnpm"]
