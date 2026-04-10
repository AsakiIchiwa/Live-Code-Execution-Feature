# ── Stage 1: Build ──
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate
COPY src ./src
RUN npm run build

# ── Stage 2: Production ──
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 tini openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 1001 appgroup && useradd -u 1001 -g appgroup -s /bin/sh -m appuser

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./
COPY scripts ./scripts

# Sandbox temp directory
RUN mkdir -p /tmp/sandbox && chown appuser:appgroup /tmp/sandbox

USER appuser

EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.js"]
