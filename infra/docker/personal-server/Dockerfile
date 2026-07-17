FROM node:24-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/app/package.json /app/apps/app/package.json
COPY apps/personal-server/package.json /app/apps/personal-server/package.json
COPY packages/sync-core/package.json /app/packages/sync-core/package.json

RUN npm ci --omit=dev --workspace @locoris/personal-server --include-workspace-root=false

FROM node:24-bookworm-slim

WORKDIR /app

COPY --from=dependencies /app/node_modules /app/node_modules
COPY apps/personal-server /app/apps/personal-server
COPY packages/sync-core /app/packages/sync-core

ENV PORT=8787
ENV SYNC_DATA_DIR=/data
ENV SYNC_JOURNAL_MAX_BYTES=2097152

RUN mkdir -p /data && chown -R node:node /data

USER node

EXPOSE 8787
VOLUME ["/data"]
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]

CMD ["node", "/app/apps/personal-server/server.mjs"]
