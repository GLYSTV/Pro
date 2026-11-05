# syntax=docker/dockerfile:1
# ───────────────────────────────────────────────────────────────
#  GLYSTV-PRO · imagen de producción (Next.js standalone)
#  Construir:  docker build -t glystv-pro .
#  Ejecutar:   ver docker-compose.yml
# ───────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    DOCKER_BUILD=1 \
    NODE_ENV=production
# Valor de relleno: el build nunca se conecta a la base de datos, pero el módulo
# de conexión exige que la variable exista. En ejecución se usa la real.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    RECORDINGS_DIR=/app/data/recordings
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home /app nextjs \
  && mkdir -p /app/data/recordings \
  && chown -R nextjs:nodejs /app
# Solo lo imprescindible del servidor autónomo (el trazador de archivos puede
# arrastrar código fuente del proyecto; aquí se deja fuera de la imagen).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/server.js ./server.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
VOLUME ["/app/data/recordings"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
