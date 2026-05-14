# ── Build stage: native deps için (better-sqlite3) ──────────────
FROM node:20-alpine AS builder

WORKDIR /build

RUN apk add --no-cache python3 make g++

COPY backend/package*.json ./
RUN npm ci --omit=dev

# ── Production stage ────────────────────────────────────────────
FROM node:20-alpine AS production

RUN addgroup -g 1001 -S desttek && \
    adduser  -u 1001 -S desttek -G desttek

WORKDIR /app

# Native modules (builder'da derlendi)
COPY --from=builder /build/node_modules ./backend/node_modules

# Uygulama kaynak kodu ve statik dosyalar
COPY --chown=desttek:desttek backend/ ./backend/
COPY --chown=desttek:desttek frontend/ ./frontend/
COPY --chown=desttek:desttek admin/    ./admin/

# SQLite data dizini — Render'da bu path'e Disk bağlanacak
RUN mkdir -p data/backups && chown -R desttek:desttek data

USER desttek

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1

EXPOSE 3000

CMD ["node", "backend/src/index.js"]
