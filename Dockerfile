# One image with everything: the API server, the Telegram bot, the game screen (/) and the staff dashboard (/admin/).
# Built by deploy/docker-compose.yml; see DEPLOY.md.

# ── 1. Game screen and dashboard ────────────────────────────────────────────────
FROM node:22-slim AS web
WORKDIR /src
# Shown in the game header.
ARG BRAND_NAME=Bingo
ENV VITE_BRAND_NAME=${BRAND_NAME} \
    VITE_API_URL= \
    VITE_DEV_LOGIN=false
COPY miniapp/package.json miniapp/package-lock.json miniapp/
COPY admin/package.json admin/package-lock.json admin/
RUN cd miniapp && npm ci --no-audit --no-fund && cd ../admin && npm ci --no-audit --no-fund
COPY miniapp miniapp
COPY admin admin
# Local .env files are not used for production builds.
RUN rm -f miniapp/.env admin/.env \
 && cd miniapp && npm run build \
 && cd ../admin && npm run build

# ── 2. API server ───────────────────────────────────────────────────────────────
# The full Debian image already has OpenSSL, which the database client (Prisma) needs; nothing to install.
FROM node:22-bookworm AS api
WORKDIR /src/backend
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma prisma
RUN npm ci --no-audit --no-fund
COPY backend .
RUN npx prisma generate && npm run build

# ── 3. What runs on the server ──────────────────────────────────────────────────
FROM node:22-bookworm
WORKDIR /app/backend
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma prisma
# Production dependencies only (prisma is one of them: it applies database migrations at start).
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npx prisma generate && npm cache clean --force
COPY --from=api /src/backend/dist dist
COPY backend/assets assets
# Sample-player script, usable only in TEST MODE with the test key.
COPY backend/scripts scripts
COPY --from=web /src/miniapp/dist /app/miniapp/dist
COPY --from=web /src/admin/dist /app/admin/dist
USER node
EXPOSE 3000
# Apply any new database migrations, then start. Safe to repeat: applied migrations are skipped.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
