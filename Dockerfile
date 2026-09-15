# syntax=docker/dockerfile:1

# Pinned to the project's Node version (.nvmrc). bookworm-slim is glibc-based,
# which matches sharp's prebuilt linux binaries (avoids Alpine/musl issues).
ARG NODE_VERSION=24.16.0

# ---- build stage: install all deps and produce .output/ ----
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_* vars are inlined into the client bundle at build time, so the public
# asset base URL must be known here (not at container start). CI passes the
# assets CloudFront URL as this build arg.
ARG VITE_STORAGE_PUBLIC_BASE
ENV VITE_STORAGE_PUBLIC_BASE=${VITE_STORAGE_PUBLIC_BASE}
RUN npm run build
# The only place this can go red: CI builds a checkout that still has
# `.gitignore`, this stage builds one shaped by `.dockerignore`. See #397.
RUN node scripts/check-asset-manifest.mjs

# ---- runtime stage: production deps + built server + migrations ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Production dependencies only (drizzle-orm + pg power the migration script;
# the Nitro server may also resolve externalized native deps like sharp here).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/.output ./.output
# Migration assets and ops scripts, used by one-off ECS tasks
# (`node scripts/migrate.mjs`, `node scripts/promote-admin.mjs`,
# `node scripts/image-url-legacy.mjs`, `node scripts/import-legacy.mjs`,
# `node scripts/backfill-embeddings.mjs`).
COPY drizzle ./drizzle
COPY scripts/migrate.mjs scripts/promote-admin.mjs scripts/image-url-legacy.mjs scripts/import-legacy.mjs scripts/backfill-embeddings.mjs ./scripts/
# `import-legacy.mjs` reads its data (the projects JSONL and image-keys.json)
# at runtime from a PRIVATE S3 prefix, not from here. That data names 299 real
# proposers and their addresses, and this repo is public and mirrors to
# GitLab, so it must never be committed or baked into an image layer.

# RDS requires TLS (rds.force_ssl); DATABASE_URL points sslrootcert at this
# bundle so pg can verify the server cert (sslmode=verify-full) instead of
# just encrypting blind.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
