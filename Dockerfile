# syntax=docker/dockerfile:1.7
# Glimpse: web app + render worker in one image. Needs PostgreSQL and Redis alongside; files go to a mapped folder (default) or S3.

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG GLIMPSE_VERSION=dev
ENV GLIMPSE_VERSION=${GLIMPSE_VERSION}
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ARG GLIMPSE_VERSION=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    GLIMPSE_VERSION=${GLIMPSE_VERSION} \
    DATA_DIR=/data \
    APP_DIR=/app \
    PORT=3000 \
    PUID=99 \
    PGID=100 \
    TZ=UTC
RUN apk add --no-cache ffmpeg libheif-tools postgresql17-client su-exec tini tzdata fontconfig font-inter shadow \
 && fc-cache -f
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data /media
VOLUME ["/data"]
EXPOSE 3000
LABEL org.opencontainers.image.title="Glimpse" \
      org.opencontainers.image.description="Self-hosted one second a day video diary" \
      org.opencontainers.image.source="https://github.com/YOUR_GITHUB_USER/glimpse" \
      org.opencontainers.image.licenses="MIT"
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "/app/dist/start.js"]
