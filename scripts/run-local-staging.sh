#!/usr/bin/env bash
# Local staging without Docker. Same fail-closed gates as production (docs/DEPLOYMENT.md).
# Canonical deploy is docker-compose.staging.yml; use this only when Compose is unavailable.
#
#   ./scripts/run-local-staging.sh fail-closed
#   ./scripts/run-local-staging.sh start
#   ./scripts/run-local-staging.sh provision
#   ./scripts/run-local-staging.sh smoke
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-47331}"
DB_NAME="${STAGING_DB_NAME:-meridian_staging}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-meridian}"
PGPASSWORD="${STAGING_DB_PASSWORD:-${PGPASSWORD:-meridian}}"
export PGPASSWORD
STAGING_AUTH_SECRET="${STAGING_AUTH_SECRET:-}"
MERIDIAN_IMAGE_TAG="${MERIDIAN_IMAGE_TAG:-$(git rev-parse HEAD 2>/dev/null || echo local)}"
# Do not inherit sandbox DATABASE_URL. Staging uses a dedicated database unless
# STAGING_DATABASE_URL is set explicitly.
if [[ -n "${STAGING_DATABASE_URL:-}" ]]; then
  DATABASE_URL="$STAGING_DATABASE_URL"
else
  DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:5432/${DB_NAME}"
fi

export NODE_ENV=production
export PLATFORM_MODE=production
export DEPLOY_ENV=staging
export DATABASE_DRIVER=postgres
export DATABASE_URL
export PRODUCTION_ROUTING_AVAILABLE=false
export PRODUCTION_EXECUTION_AVAILABLE=false
export SEED_DEMO_TENANTS=false
export API_HOST=127.0.0.1
export API_PORT
export LOG_LEVEL="${LOG_LEVEL:-info}"
export LOG_PRETTY=false
export MERIDIAN_IMAGE_TAG

ensure_secret() {
  if [[ -z "${STAGING_AUTH_SECRET}" ]]; then
    STAGING_AUTH_SECRET="$(openssl rand -hex 32)"
    echo "Generated ephemeral STAGING_AUTH_SECRET (not committed)." >&2
  fi
  export AUTH_SECRET="${STAGING_AUTH_SECRET}"
}

ensure_db() {
  if ! psql -h "$PGHOST" -U "$PGUSER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    createdb -h "$PGHOST" -U "$PGUSER" -O "$PGUSER" "$DB_NAME"
  fi
}

cmd_migrate() {
  ensure_db
  npx prisma migrate deploy
}

cmd_fail_closed() {
  ensure_secret
  if [[ ! -f apps/api/dist/server.js ]]; then
    npm run build
  fi

  expect_fail() {
    local name="$1"
    shift
    local log status
    log="$(mktemp)"
    set +e
    timeout 8 env "$@" node apps/api/dist/server.js >"$log" 2>&1
    status=$?
    set -e
    if [[ "$status" -eq 0 || "$status" -eq 124 ]]; then
      echo "fail-closed check '${name}' started or hung (exit ${status}) but should have been rejected" >&2
      cat "$log" >&2
      rm -f "$log"
      exit 1
    fi
    if ! grep -Eq 'DATABASE_DRIVER|AUTH_SECRET|SEED_DEMO_TENANTS|DEPLOY_ENV|memory is forbidden|demo password|not a relaxed sandbox' "$log"; then
      echo "fail-closed check '${name}' failed for the wrong reason:" >&2
      cat "$log" >&2
      rm -f "$log"
      exit 1
    fi
    rm -f "$log"
    echo "fail-closed ok: ${name}"
  }

  expect_fail 'staging + memory driver' \
    -u DATABASE_URL DATABASE_DRIVER=memory

  expect_fail 'staging + demo AUTH_SECRET' \
    AUTH_SECRET='MeridianDemo!2026'

  expect_fail 'staging + SEED_DEMO_TENANTS' \
    SEED_DEMO_TENANTS=true

  expect_fail 'staging without production lock' \
    -u DATABASE_URL -u AUTH_SECRET \
    NODE_ENV=development PLATFORM_MODE=sandbox DATABASE_DRIVER=memory
}

cmd_start() {
  ensure_secret
  cmd_migrate
  if [[ ! -f apps/api/dist/server.js ]]; then
    npm run build
  fi
  exec node apps/api/dist/server.js
}

cmd_provision() {
  ensure_secret
  : "${STAGING_OPERATOR_EMAIL:?STAGING_OPERATOR_EMAIL is required}"
  : "${STAGING_OPERATOR_PASSWORD:?STAGING_OPERATOR_PASSWORD is required}"
  npx tsx apps/api/src/ops/provision-staging-operator.ts
}

cmd_smoke() {
  export STAGING_API_BASE_URL="${STAGING_API_BASE_URL:-http://127.0.0.1:${API_PORT}}"
  npm run test:staging-smoke
}

usage() {
  echo "usage: $0 fail-closed | migrate | start | provision | smoke" >&2
  exit 2
}

case "${1:-}" in
  fail-closed) cmd_fail_closed ;;
  migrate) cmd_migrate ;;
  start) cmd_start ;;
  provision) cmd_provision ;;
  smoke) cmd_smoke ;;
  *) usage ;;
esac
