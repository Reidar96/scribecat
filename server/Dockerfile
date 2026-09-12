# syntax=docker/dockerfile:1

# ---- build: web client + server ------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.web.json vite.config.ts ./
COPY src ./src
COPY web ./web
RUN npm run build

# ---- deps: production node_modules only ----------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:24-alpine
ENV NODE_ENV=production \
    SCRIBEDOG_VAULT_PATH=/data \
    SCRIBEDOG_HOST=0.0.0.0 \
    SCRIBEDOG_PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The vault is a bind mount; the directory only exists here so a container
# started without one still has somewhere writable and owned by "node".
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "dist/server/healthcheck.js"]
CMD ["node", "dist/server/index.js"]
