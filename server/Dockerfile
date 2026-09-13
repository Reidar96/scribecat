# syntax=docker/dockerfile:1
#
# Built from the repository root (see docker-compose.yml: context "..") because
# the web client is the desktop app's own frontend under /src, built with
# `npm run build:web` from the root package. The root .dockerignore keeps
# everything else (Rust target directory, node_modules, docs) out of the
# build context.

# ---- web: the shared frontend, built for the browser -------------------------
FROM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json THIRD_PARTY_LICENSES.md ./
COPY public ./public
COPY src ./src
RUN npm run build:web

# ---- server: TypeScript -> dist/server ---------------------------------------
FROM node:24-alpine AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ---- deps: production node_modules only --------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime -------------------------------------------------------------------
FROM node:24-alpine
ENV NODE_ENV=production \
    SCRIBEDOG_VAULT_PATH=/data \
    SCRIBEDOG_HOST=0.0.0.0 \
    SCRIBEDOG_PORT=3000 \
    SCRIBEDOG_WEB_DIST_DIR=/app/dist-web
WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=web /app/dist-web /app/dist-web
COPY server/package.json ./
# The vault is a bind mount; the directory only exists here so a container
# started without one still has somewhere writable and owned by "node".
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "dist/server/healthcheck.js"]
CMD ["node", "dist/server/index.js"]
