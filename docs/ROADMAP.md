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
  Prisma cannot express, plus the Organization / User / ApiKey tables authentication is prepared around.
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

## Phase 2 — Database and core domain model ✅ implemented

- Fifteen tables covering tenancy (`Organization`, `User`, `OrganizationMember`, `ApiKey`), providers
  (`Provider`, `ProviderCapability`), pricing (`Route`, `CustomerPricing`), requests and quotes
  (`TransactionRequest`, `Quote`, `QuoteLeg`, `Fee`), reference data (`Currency`) and the
  reproducibility and audit records (`Comparison`, `AuditLog`).
- The non-custody boundary enforced by the schema: `TransactionRequestStatus` has no settlement
  state to write, and no table can represent customer funds.
- Amounts as `DECIMAL(38, 0)` minor units, rates as `DECIMAL(38, 18)`, and seventeen invariants
  Prisma cannot express added by hand and asserted twice.
- A seed that prices its demo quotes by running the real engine rather than by fixture, and stores
  no credential of any kind.
- Thirty-one integration tests against a real PostgreSQL, gated on `TEST_DATABASE_URL`.

**Still excluded:** authentication is still architecture only, PostgreSQL is not yet the default
driver, and nothing reads provider capability from the database yet.

## Phase 2b — Authentication and multi-tenancy _(not started)_

Implement the authentication whose architecture Phase 1 prepared: verify API keys and session tokens
against the `Organization`, `User` and `ApiKey` tables, scope every query by `organizationId`, and add
per-tenant rate limits. Make PostgreSQL the default driver, with the database integration suite
running in CI. Then comparison history and per-tenant audit retention.

Still excluded: enterprise SSO, SAML and SCIM.

## Phase 3 — Market data and provider architecture ✅ implemented

- Capability interfaces: `MarketDataProvider`, `FXProvider`, `PaymentProvider`,
  `LiquidityProvider`, over one common `ProviderAdapter` base.
- `FXRouteProvider` bridges a capability provider to the engine-facing `RouteProvider`, so nothing
  provider-specific reaches the routing engine.
- One resilience pipeline: per-attempt timeout with abort, an overall latency budget, bounded
  jittered retry of transport failures only, and a record of every attempt.
- Quote freshness: expiry, staleness against the platform's own bound, an expiry guard and clock
  skew, each distinguished because the remedies differ.
- `DemoMarketDataProvider` and `DemoFXProvider`, deterministic and priced against an independent
  benchmark.

**Still excluded:** live partner credentials, circuit breakers, upstream rate limiting and quote
caching. Read-only pricing only; no money movement.

## Phase 4 — Quote engine ✅ implemented

- `organizationId` threaded through the engine, so two customers can be quoted different prices from
  identical provider input.
- Platform pricing wired to the `customer_pricing` table: markup, negotiated spread discount and flat
  fee, resolved by a pure priority-and-specificity algorithm that replays from a snapshot.
- The platform's take charged as an explicit fee and reported separately from the provider's.
- Six-factor deterministic scoring: cost, speed, reliability, slippage, liquidity and risk.
- Engine version bumped to 2.0.0, and replay now reports `engine_version_changed` rather than
  claiming reproducibility it cannot demonstrate.
- The mathematics documented formally in [QUOTE_ENGINE.md](./QUOTE_ENGINE.md).

## Phase 4b — Route comparison UI, productised ✅ implemented

- The results page follows the order a customer uses it: transaction input, a best-route hero with
  every figure needed to act (rate, provider fee, platform fee, total cost, receive amount,
  settlement time, quote expiry), the alternatives that justify it, a cost-comparison chart, and
  expandable details under each route for anyone arguing with a number.
- Quote expiration is a live state, not a timestamp: a ticking countdown per quote, an amber warning
  in the final twenty seconds, and an expired banner with a refresh action once the shortest-lived
  quote lapses — because a ranking computed against a lapsed price is no longer a ranking.
- "Continue with partner" is the only forward action, opening an honest dialog about the
  non-custodial position. No control implies execution, and a test asserts none exists.
- Formatting and expiry classification are pure functions with their own unit suite, so the
  financial display contract fails faster than a browser run.

## Phase 5 — Live provider adapters _(not started)_

Replace sandbox pricing with real read-only quote APIs from licensed partners: per-adapter
credential resolution, circuit breakers, upstream rate limiting, quote caching with TTL honouring
`expiresAt`, and per-provider reconciliation of quoted vs. observed cost. Re-express the four
dataset rails as `FXProvider`/`PaymentProvider`/`LiquidityProvider` behind bridges, read provider
capability from the database, and persist quotes through the `quotes` table.

## Phase 6 — Corridor intelligence _(not started)_

Historical quote warehousing, realised-vs-quoted cost analytics, corridor benchmarks, alerting
on spread anomalies, and a scheduled corridor coverage report.

## Phase 7 — Execution orchestration, licensed partners only _(not started, gated)_

Requires: a licensed partner of record, a compliance sign-off, KYB/KYC and sanctions screening,
and an explicit written instruction to build it. Meridian would remain non-custodial —
instructing a licensed partner, never touching funds. Until all of those exist,
`POST /v1/executions` stays a `501`.

## Phase 8 — Treasury and DEX liquidity research _(not started, gated)_

Read-only DEX liquidity depth modelling and treasury product comparison. Read-only analysis
only; no on-chain transactions, no asset holdings.
