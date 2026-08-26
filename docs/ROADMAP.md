# Meridian — Phase Roadmap

Phases are implemented **one at a time, on explicit instruction only**. Nothing below Phase 1
has been built.

---

## Phase 1 — Route comparison MVP ✅ implemented

_"Find the best financial route for a business transaction."_

- Monorepo, strict TypeScript, lint/typecheck/test pipeline.
- `packages/core`: decimal-safe money, domain model, provider port, cost engine, scorer,
  canonical fingerprinting, typed errors.
- `packages/adapters`: four sandbox rails (bank FX, FX provider, stablecoin partner, liquidity
  provider) priced from versioned external data files, plus a provider conformance suite.
- `packages/persistence`: comparison + audit repositories, in-memory and Prisma/PostgreSQL drivers.
- `prisma/`: schema and migrations, including the CHECK constraints and append-only audit trigger
  Prisma cannot express, plus the Organisation / User / ApiKey tables authentication is prepared around.
- `apps/api`: REST API versioned at `/api/v1` (with `/v1` kept as a deprecated alias) — validated
  `POST /api/v1/comparisons`, `GET /api/v1/comparisons/:id`, `POST /api/v1/comparisons/:id/replay`,
  per-comparison audit, corridor/provider metadata, `GET /api/v1/health`, unversioned liveness and
  readiness, and a hard `501` execution guard.
- Authentication _architecture_: an `Authenticator` port, a `Principal` carrying the tenant boundary,
  and audit attribution taken from it. Phase 1 rejects credentials it cannot verify rather than
  serving them as anonymous.
- `apps/web`: comparison UI with ranked routes, cost breakdown, recommendation, and loading /
  empty / error states.
- Unit tests for financial calculations, integration tests for every endpoint, and Playwright
  end-to-end coverage of the API contract, the browser journey and mobile layout.

**Explicitly excluded:** custody, execution, crypto holdings, stablecoin issuance, regulated
activity without a licensed partner.

## Phase 2 — Authentication, multi-tenancy and persistence hardening _(not started)_

Implement the authentication whose architecture Phase 1 prepared: verify API keys and session tokens
against the existing `Organisation`, `User` and `ApiKey` tables, scope every query by
`organisationId`, and add per-tenant rate limits. Make PostgreSQL the default driver with
`prisma migrate deploy` and a live-database integration suite in CI — the Prisma driver's row mapping
is unit-tested today, but no test has yet executed the SQL. Then comparison history and per-tenant
audit retention.

Still excluded: enterprise SSO, SAML and SCIM.

## Phase 3 — Live provider adapters _(not started)_

Replace sandbox pricing with real read-only quote APIs from licensed partners: per-adapter
credential resolution, circuit breakers, upstream rate limiting, quote caching with TTL
honouring `expiresAt`, and per-provider reconciliation of quoted vs. observed cost.

## Phase 4 — Corridor intelligence _(not started)_

Historical quote warehousing, realised-vs-quoted cost analytics, corridor benchmarks, alerting
on spread anomalies, and a scheduled corridor coverage report.

## Phase 5 — Execution orchestration, licensed partners only _(not started, gated)_

Requires: a licensed partner of record, a compliance sign-off, KYB/KYC and sanctions screening,
and an explicit written instruction to build it. Meridian would remain non-custodial —
instructing a licensed partner, never touching funds. Until all of those exist,
`POST /v1/executions` stays a `501`.

## Phase 6 — Treasury and DEX liquidity research _(not started, gated)_

Read-only DEX liquidity depth modelling and treasury product comparison. Read-only analysis
only; no on-chain transactions, no asset holdings.
