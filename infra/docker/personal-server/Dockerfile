FROM node:25-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/app/package.json /app/apps/app/package.json
COPY apps/personal-server/package.json /app/apps/personal-server/package.json
COPY packages/sync-core/package.json /app/packages/sync-core/package.json

RUN npm ci --omit=dev --workspace @locoris/personal-server --include-workspace-root=false

FROM node:25-bookworm-slim

LABEL org.opencontainers.image.title="Locoris Server" \
      org.opencontainers.image.description="Self-hosted sync server for Locoris" \
      org.opencontainers.image.source="https://github.com/locoris/locoris" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

WORKDIR /app

COPY --from=dependencies /app/node_modules /app/node_modules
COPY apps/personal-server /app/apps/personal-server
COPY packages/sync-core /app/packages/sync-core
COPY LICENSE THIRD_PARTY_NOTICES.md TRADEMARKS.md /app/legal/

ENV PORT=26747
ENV SYNC_DATA_DIR=/data
ENV SYNC_JOURNAL_MAX_BYTES=2097152

RUN mkdir -p /data && chown -R node:node /data

USER node

EXPOSE 26747
VOLUME ["/data"]
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]

CMD ["node", "/app/apps/personal-server/server.mjs"]
