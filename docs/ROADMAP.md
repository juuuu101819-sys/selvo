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
- `packages/persistence`: comparison + audit repositories, in-memory and PostgreSQL drivers.
- `apps/api`: validated `POST /v1/comparisons`, `GET /v1/comparisons/:id`,
  `POST /v1/comparisons/:id/replay`, corridor/provider metadata, health, and a hard
  `501` execution guard.
- `apps/web`: comparison UI with ranked routes, cost breakdown, recommendation, and loading /
  empty / error states.
- Unit tests for financial calculations, integration tests for every endpoint.

**Explicitly excluded:** custody, execution, crypto holdings, stablecoin issuance, regulated
activity without a licensed partner.

## Phase 2 — Persistence hardening and multi-tenancy _(not started)_

Organisations, API keys/JWT with per-tenant rate limits, PostgreSQL as the default driver with
migration tooling in CI, comparison history and per-tenant audit retention.

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
