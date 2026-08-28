# Meridian — Staging and production deployment

This is the operator contract for **where the process runs**. Fail-closed safety still comes from
[`PRODUCTION_GATES.md`](./PRODUCTION_GATES.md) (PA-C01–C03). Staging is a deployment target, not a
relaxed sandbox: it uses `NODE_ENV=production`, `PLATFORM_MODE=production`, PostgreSQL, no demo
tenants, and `POST /api/v1/executions` remains **501**.

The artefact CI builds is the artefact staging runs. There is no second untested Dockerfile.

---

## 1. Environment parity

| Variable | Development | Staging | Production |
| -------- | ----------- | ------- | ---------- |
| `NODE_ENV` | `development` | `production` | `production` |
| `PLATFORM_MODE` | `sandbox` | `production` | `production` |
| `DEPLOY_ENV` | `development` (default) | `staging` (required) | `production` (default when locked) |
| `DATABASE_DRIVER` | `memory` allowed | `postgres` required | `postgres` required |
| `DATABASE_URL` | optional | required, injected | required, injected |
| `AUTH_SECRET` | optional | required, injected, ≥32 chars, not a demo/default | same |
| `SEED_DEMO_TENANTS` | auto-seed | `false`; `true` is a startup failure | same |
| `PRODUCTION_ROUTING_AVAILABLE` | must be `false` | `false` until a licensed adapter exists | same |
| `PRODUCTION_EXECUTION_AVAILABLE` | `false` | `false`; `true` is a startup failure | same |

`DEPLOY_ENV=staging` **without** a production-locked process is a startup failure. Staging cannot
turn demo providers back on, cannot use the memory driver, and cannot seed `treasury@demo-trading.example.invalid`.

`GET /api/v1/meta` publishes:

- `productionGates.routingAvailable` / `executionAvailable` (PA-C01)
- `execution.statusCode` (always 501)
- `deployment.environment` (`staging` | `production` | `development`)
- `deployment.imageTag` from `MERIDIAN_IMAGE_TAG` (git SHA in CI; not a secret)
- `persistenceDriver` (must be `postgres` in staging)

Liveness: `GET /health`. Readiness (schema present): `GET /ready`. The image HEALTHCHECK hits `/health`.

### Intentional differences from production (explicit)

These are the only allowed gaps. They are scale/ops differences, not safety relaxations.

| Difference | Staging | Production |
| ---------- | ------- | ---------- |
| Replica count | One API container (compose) | Operator-chosen; still one image |
| Bind address | `127.0.0.1:47331` on the host (localhost only in compose) | Platform load balancer |
| Postgres | Dedicated `meridian_staging` volume; published on `127.0.0.1:54332` | Platform-managed database; not published to developer laptops |
| Data | Empty by default. Optional **labelled synthetic** operator (`--profile synthetic`) | Real organizations only after a separate authorization |
| Billing | None. No invoices, subscriptions, or payouts (PA-M09 deferred) | Same code; still no billing product |
| Licensed quotes | None. PHASE 30 is **blocked** until a named licensed partner of record is confirmed. Comparison/quote return **422** (`UNSUPPORTED_CORRIDOR` / `NO_ROUTES_AVAILABLE`). | Same empty licensed registry until that confirmation exists |
| Web app | Not in the API image. Point `API_BASE_URL` at staging if you run Next separately | Same split: API image vs web |
| Log sink | `docker compose logs api` (JSON on stdout) | Same JSON; attach the platform’s log drain |

Do not “make staging easier to demo” by setting `PLATFORM_MODE=sandbox` or `SEED_DEMO_TENANTS=true`.

---

## 2. Secrets

Nothing secret is committed. `.env`, `.env.staging`, and `.env.*` are gitignored. `.env.example` and
`.env.staging.example` contain **placeholders only**. The Docker image does not bake `AUTH_SECRET`,
`DATABASE_URL`, demo passwords, or `mag_` secrets (asserted in CI).

| Secret | Staging source | Notes |
| ------ | -------------- | ----- |
| `STAGING_AUTH_SECRET` → `AUTH_SECRET` | Compose env-file / GitHub Actions job env / platform secret store | ≥32 characters. Rejected if it equals a documented demo password or agent secret. Never copied onto `AppConfig`. Never logged (pino redacts `*.AUTH_SECRET`). |
| `STAGING_DB_PASSWORD` → `DATABASE_URL` | Same | URL-injected. Pino redacts `*.DATABASE_URL`. |
| `STAGING_OPERATOR_PASSWORD` | Only with `--profile synthetic` | Not the demo password. Optional. |
| Future `PROVIDER_*` keys | Same secret store | Not used. No licensed adapter exists; do not invent placeholder partner credentials. Never commit. |

CI generates fresh hex secrets per staging-smoke job; they are not stored in the repo.

Client errors remain PA-M03 safe DTOs. Server logs keep full detail on stdout, with credential
fields stripped. Audit events (PA-M04) never include raw passwords or `AUTH_SECRET`.

---

## 3. Observability

- **Build identity:** CI `container` job builds `docker build --target api -t meridian-api:$SHA`.
  Staging compose passes `MERIDIAN_IMAGE_TAG=$SHA` into the same Dockerfile. Confirm
  `GET /api/v1/meta` → `deployment.imageTag` matches the git SHA you intended to ship.
- **Health:** `/health` (process), `/ready` (postgres + schema), `/api/v1/meta` (gates).
- **Logs:** JSON on stdout.

```bash
docker compose -f docker-compose.staging.yml logs -f api
```

On GitHub Actions, the staging job dumps `docker compose logs` on failure. Attach the same stdout
to CloudWatch / Datadog / the host’s journal in a real platform; do not add a second logger.

---

## 4. Rollback

There is no automatic rollback tool. Manual procedure:

1. Identify the currently serving image: `deployment.imageTag` on `/api/v1/meta`, or
   `docker compose images`.
2. Check out or retag the **previous CI-built** image (`meridian-api:<previous-sha>`). Do not
   rebuild from an untested tree.
3. `docker compose -f docker-compose.staging.yml up -d api` with the previous tag
   (`MERIDIAN_IMAGE_TAG=<previous-sha>`).
4. Confirm `/health`, `/ready`, `/api/v1/meta` (`execution.statusCode === 501`,
   `productionGates.executionAvailable === false`).
5. **Do not** run `prisma migrate reset` as rollback. That destroys data.

### Migration reversibility

All migrations under `prisma/migrations/` are **forward-only**. Apply with `prisma migrate deploy`
(the `migrate` compose service). They are additive or data-preserving renames:

| Migration | Rollback note |
| --------- | ------------- |
| `20260826120000_init` through identity/sessions | Additive tables. Reverse = restore previous dump, not DROP. |
| `20260827123000_financial_routing_api` | Additive. CHECKs keep intents non-executable. |
| `20260827140000_agent_payments` | Additive. `controlled_by_platform = false` CHECK. |
| `20260828120000_payment_intent_status_rename` (PA-H13) | Rewrites `AUTHORIZED`/`COMPLETED` labels to `POLICY_APPROVED`/`SIMULATION_*`. Forward-only. Rolling back the **application** to a build that still writes old names will fail the new CHECK. Restore a DB snapshot taken before that migrate if you must run pre-H13 code. |
| `20260828140000_rate_limit_buckets` | Additive. |
| `20260828150000_mfa_oidc` | Additive ciphertext columns. |
| `20260828160000_phase28_status_enum_daily_spend_idx` | Enum + indexes. Additive. Downgrading the app that still writes `status` as unconstrained text is safe; the enum only allows `recorded`. |

Take a Postgres dump **before** applying a new migrate in staging:

```bash
docker compose -f docker-compose.staging.yml exec postgres \
  pg_dump -U meridian meridian_staging > staging-pre-migrate.sql
```

---

## 5. Bring staging up

Canonical path is Compose using the **same** `Dockerfile --target api` CI builds. Secrets come from
`.env.staging` (gitignored) or the platform secret store — never from the image.

```bash
cp .env.staging.example .env.staging
# set STAGING_AUTH_SECRET and STAGING_DB_PASSWORD (unique, ≥32 / strong)
docker compose -f docker-compose.staging.yml --env-file .env.staging up --build -d
until curl -sf http://127.0.0.1:47331/health; do sleep 2; done
```

`up --wait` on the whole project is unreliable: `migrate` and `provision-operator` are oneshot and
exit. Poll `/health` (and `/ready`) instead. CI does the same: build → postgres → `run --rm migrate`
→ optional synthetic operator → `up -d api` → smoke.

Optional labelled synthetic operator (not demo, not production customer data):

```bash
# also set STAGING_OPERATOR_EMAIL and STAGING_OPERATOR_PASSWORD in .env.staging
docker compose -f docker-compose.staging.yml --env-file .env.staging --profile synthetic \
  run --rm provision-operator
```

Without Docker (same env, local Postgres) — used when Compose is unavailable. The helper
**does not inherit** a sandbox `DATABASE_URL`; it targets `meridian_staging` unless
`STAGING_DATABASE_URL` is set.

```bash
export STAGING_DB_PASSWORD='...' STAGING_AUTH_SECRET='...'   # not committed
./scripts/run-local-staging.sh fail-closed   # memory driver / demo secret must fail
./scripts/run-local-staging.sh start         # migrate + listen on 127.0.0.1:47331
# another terminal:
./scripts/run-local-staging.sh provision     # optional labelled operator
./scripts/run-local-staging.sh smoke
```

Smoke:

```bash
STAGING_API_BASE_URL=http://127.0.0.1:47331 npm run test:staging-smoke
# with synthetic operator, also export STAGING_OPERATOR_EMAIL / STAGING_OPERATOR_PASSWORD
```

The smoke suite checks: meta gates, postgres driver, `POST /executions` → 501, demo login → 401,
comparison/quote → 422 (no invented licensed quotes), and authenticated `/auth/me` + quote when an
operator is configured. Default staging has **no users** unless you provision the synthetic operator.

Logs without Docker: the process writes JSON to stdout/stderr (tmux/journal/`tee`).

---

## 6. Production (same image)

```bash
docker build --target api --build-arg GIT_SHA=$(git rev-parse HEAD) -t meridian-api:$(git rev-parse HEAD) .
docker run --rm -p 47311:47311 \
  -e DATABASE_URL=postgresql://user:pass@db:5432/meridian \
  -e AUTH_SECRET=replace-with-a-32-character-operator-secret \
  -e DEPLOY_ENV=production \
  -e MERIDIAN_IMAGE_TAG=$(git rev-parse HEAD) \
  meridian-api:$(git rev-parse HEAD)
```

Do not set `PRODUCTION_EXECUTION_AVAILABLE=true`. Do not seed demo tenants.
Do not set `PRODUCTION_ROUTING_AVAILABLE=true` until a licensed partner of record is recorded in
[`COMPLIANCE.md`](./COMPLIANCE.md) and a real quoting adapter for that partner exists.

Related: [`PRODUCTION_GATES.md`](./PRODUCTION_GATES.md), [`COMPLIANCE.md`](./COMPLIANCE.md),
[`DATABASE.md`](./DATABASE.md).
