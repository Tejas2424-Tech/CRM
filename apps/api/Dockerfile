# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace manifests so Docker cache layer is only invalidated on
# dependency changes, not source changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json       packages/shared/
COPY apps/api/package.json              apps/api/

RUN npm ci --ignore-scripts

# Copy source and build
COPY packages/shared/ packages/shared/
COPY apps/api/        apps/api/

RUN npm run build --workspace @crm/shared
RUN npm run build --workspace @crm/api

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Only install production deps in the final image
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json       packages/shared/
COPY apps/api/package.json              apps/api/

RUN npm ci --omit=dev --ignore-scripts

# Copy compiled output from build stage
COPY --from=builder /app/apps/api/dist  apps/api/dist
COPY --from=builder /app/packages/shared/dist packages/shared/dist

EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "apps/api/dist/apps/api/src/server.js"]
