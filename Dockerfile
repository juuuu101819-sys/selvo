# syntax=docker/dockerfile:1
#
# Production API image. Fail-closed configuration from docs/PRODUCTION_GATES.md (PA-C01–C03):
# production mode, postgres only, demo tenants off, routing/execution flags false.
# AUTH_SECRET and DATABASE_URL are required at runtime and must never be baked in.
# POST /api/v1/executions remains 501. No demo providers or credentials are compiled into ENV.
#
# Targets:
#   build   — compile workspace (devDependencies still present)
#   migrate — `prisma migrate deploy` (needs the Prisma CLI)
#   api     — pruned runtime image (CI builds this target)

FROM node:22-bookworm-slim AS build
WORKDIR /app

ARG GIT_SHA=unknown
ENV MERIDIAN_IMAGE_TAG=${GIT_SHA}

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/adapters/package.json packages/adapters/
COPY packages/persistence/package.json packages/persistence/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY prisma prisma
COPY prisma.config.ts ./

RUN npm ci

COPY tsconfig.base.json tsconfig.build.json tsconfig.json ./
COPY packages packages
COPY apps/api apps/api

RUN npx prisma generate \
  && npm run build

FROM build AS migrate
ENV NODE_ENV=production \
    DATABASE_DRIVER=postgres
# Prisma CLI remains available (this stage is not pruned). DATABASE_URL is injected at runtime.
CMD ["npx", "prisma", "migrate", "deploy"]

FROM build AS pruned
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS api
WORKDIR /app

ARG GIT_SHA=unknown
ENV MERIDIAN_IMAGE_TAG=${GIT_SHA}

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 meridian \
  && useradd --system --uid 1001 --gid meridian --home /app --shell /usr/sbin/nologin meridian

ENV NODE_ENV=production \
    PLATFORM_MODE=production \
    DATABASE_DRIVER=postgres \
    PRODUCTION_ROUTING_AVAILABLE=false \
    PRODUCTION_EXECUTION_AVAILABLE=false \
    SEED_DEMO_TENANTS=false \
    API_HOST=0.0.0.0 \
    API_PORT=47311 \
    LOG_LEVEL=info

COPY --from=pruned --chown=meridian:meridian /app/package.json /app/package-lock.json ./
COPY --from=pruned --chown=meridian:meridian /app/node_modules ./node_modules
COPY --from=pruned --chown=meridian:meridian /app/packages ./packages
COPY --from=pruned --chown=meridian:meridian /app/apps/api ./apps/api
COPY --from=pruned --chown=meridian:meridian /app/prisma ./prisma
COPY --from=pruned --chown=meridian:meridian /app/prisma.config.ts ./

USER meridian
EXPOSE 47311

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:47311/health >/dev/null || exit 1

CMD ["node", "apps/api/dist/server.js"]
