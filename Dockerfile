# syntax=docker/dockerfile:1

# --- Abhängigkeiten -----------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 kompiliert sich bei Bedarf selbst gegen die Node-ABI dieses
# Images – ohne Compiler bricht "npm ci" mit einem node-gyp-Fehler ab.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- Build --------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Laufzeit -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/gym.db

RUN groupadd --gid 1001 gym \
 && useradd --uid 1001 --gid gym --create-home gym \
 && mkdir -p /data \
 && chown -R gym:gym /data

# Der Standalone-Output enthält nur die tatsächlich benutzten Pakete.
COPY --from=builder --chown=gym:gym /app/.next/standalone ./
COPY --from=builder --chown=gym:gym /app/.next/static ./.next/static
COPY --from=builder --chown=gym:gym /app/public ./public
# Die Migrationen laufen beim Start automatisch (src/instrumentation.ts).
COPY --from=builder --chown=gym:gym /app/drizzle ./drizzle

USER gym
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
