# Meridian — Phase Roadmap

Phases are implemented **one at a time, on explicit instruction only**. User-facing phases 0–6
(route comparison through the B2B dashboard) map to Phases 1–4b and 2b below and are in place.
The expanded product definition is recorded in [MASTER_PRODUCT_DEFINITION.md](./MASTER_PRODUCT_DEFINITION.md).
Later phases wait for an explicit request.

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

**Still excluded from Phase 2 itself:** PostgreSQL is not the default driver, and provider
capability is still read from adapters rather than from the database (Phase 3).

## Phase 2b — Authentication and B2B customer dashboard ✅ implemented

- Session login (`POST /api/v1/auth/login`) and API keys (`X-Api-Key`), resolved to a `Principal`
  whose `organizationId` is the only tenant boundary handlers may use.
- Dashboard routes: metrics (quoted volume, estimated savings, quote count, successful requests,
  average route cost, average settlement), quotes, transactions, providers, settings.
- Charts and totals are aggregated from already-scoped database rows — never from another
  organization, and never from a request body `organizationId`.
- Cross-tenant resource access returns `404`, not `403`.
- Web app at `/login` and `/dashboard/*`, with an httpOnly session cookie forwarded to the API.
- Documented demo tenant: `treasury@demo-trading.example.invalid` / `MeridianDemo!2026`.
- Authorization tests covering two organizations and a service API key.

Still excluded: enterprise SSO, SAML, SCIM, MFA, and making PostgreSQL the default driver.

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

## Architectural alignment — routing hub ✅ implemented

Generalize the existing B2B FX/payment router into a **global non-custodial financial routing hub**
without rebuilding it.

- Product identity, three rail families (`tradfi`, `stablecoin`, `defi`), routing pipeline,
  economic actors and interaction models as core types.
- `PLATFORM_CAPABILITIES` as the single source of truth (comparison on; custody, keys, wallets,
  principal trading, DeFi execution, agent payments and delegated execution all off).
- `DexLiquidityProvider` port, read-only, unregistered.
- `POST /comparisons` accepts `railFamilies`; empty expansion is 400.
- Docs: master product definition and architecture assessment.

**Explicitly excluded:** DeFi quoting or execution, real-money execution, AI-agent payment
initiation, engine-version bump, schema changes.

## Phase 5 — Live provider adapters _(not started)_

Replace sandbox pricing with real read-only quote APIs from licensed partners: per-adapter
credential resolution, circuit breakers, upstream rate limiting, quote caching with TTL honouring
`expiresAt`, and per-provider reconciliation of quoted vs. observed cost. Re-express the four
dataset rails as `FXProvider`/`PaymentProvider`/`LiquidityProvider` behind bridges, read provider
capability from the database, and persist quotes through the `quotes` table.

## Phase 6 — Corridor intelligence _(not started)_

Historical quote warehousing, realised-vs-quoted cost analytics, corridor benchmarks, alerting
on spread anomalies, and a scheduled corridor coverage report.

## Phase 7 — Delegated execution, licensed partners only _(not started, gated)_

Requires: a licensed partner of record, a compliance sign-off, KYB/KYC and sanctions screening,
and an explicit written instruction to build it. Meridian would remain non-custodial —
**delegating** settlement to a licensed partner, never touching funds, keys or wallets, and never
acting as principal. Until all of those exist, `POST /v1/executions` stays a `501` and
`delegateExecution` stays false.

## Phase 8 — Multi-rail financial provider architecture ✅ implemented

A normalised `FinancialProvider` contract sits beside the existing `RouteProvider` engine port:

- Categories: `traditional`, `stablecoin`, `defi`.
- Feature tags (FX, fiat, settlement, on/off-ramp, swap, on-chain, AMM, aggregator).
- A common quote model for fiat ↔ fiat, fiat ↔ stablecoin, stablecoin ↔ stablecoin, and
  stablecoin/crypto (plus an indicative crypto → fiat composite).
- Demo adapters only: Helios Ramp, Meridian Pool (AMM), Horizon Aggregator, plus the four
  comparison rails wrapped so they speak the same contract.
- `GET /api/v1/providers` and `POST /api/v1/provider-quotes`. Quotes are never executable.
- No schema migration: crypto tickers are assets, not `VARCHAR(3)` ISO currencies.
- Comparison engine unchanged (`ENGINE_VERSION` 2.0.0, four USD→KRW routes).

**Still excluded:** on-chain execution, custody, keys, wallets, live partner credentials.

## Phase 9 — Multi-rail routing engine ✅ implemented

One normalised engine evaluates Traditional Finance, stablecoin and DeFi quotes:

- Input: `{ sourceAsset, destinationAsset, amount, organizationId, preferences }`
- Economics computed dynamically: exchange rate, provider / platform / network / gas fees, spread,
  slippage, liquidity, settlement time, reliability, availability, compliance eligibility metadata
- Configurable, explainable scores: cost 45%, speed 20%, liquidity 15%, reliability 10%,
  settlement confidence 10%
- Output: `routes[]`, `recommendedRoute`, `routeScore`, `estimatedCost`,
  `estimatedReceiveAmount`, `estimatedSettlementTime`, `routeExplanation`
- `POST /api/v1/routes`. Demo providers only. AI does not determine any financial figure.
- Comparison engine unchanged (`ENGINE_VERSION` 2.0.0, four USD→KRW routes)
- Route D (USD → stablecoin → DEX liquidity → KRW) is declared as planned, not composed

**Still excluded:** on-chain execution, custody, keys, wallets, live partner credentials,
AI-determined prices.

## Phase 10 — Financial route graph ✅ implemented

A directed graph of assets and venues, with a constrained path finder:

- Node kinds: `FIAT`, `STABLECOIN`, `CRYPTO_ASSET`, `BANK`, `FX_PROVIDER`, `PAYMENT_PROVIDER`,
  `DEX`, `AMM`, `LIQUIDITY_POOL`, `SETTLEMENT_PROVIDER`
- Edges are possible conversions or transfers (indicative cost, liquidity, availability,
  compliance). Never executable. No chain is contacted.
- Multi-hop discovery, e.g. `USD → USDC → USDT → KRW`, under max hops, max expected cost,
  minimum liquidity, supported assets, provider availability and compliance eligibility
- Cycle prevention: an asset is never revisited on the same walk
- `GET /api/v1/route-graph` and `POST /api/v1/route-graph/paths`
- `graphEngineVersion` **1.0.0**, independent of comparison `2.0.0` and routing `1.0.0`
- Comparison engine unchanged (four USD→KRW routes). Multi-rail quoting unchanged.

**Still excluded:** on-chain execution, custody, keys, wallets, live partner credentials,
AI-determined prices.

## Phase 11 — AI agent payments _(not started, gated)_

Issue `ai_agent` principals that still act *for* an organization. Agents may request quotes and
compare routes through the same API. Initiation remains delegated execution (Phase 7) and is
gated on the same compliance bar. No agent wallets, no agent custody, no agent-to-agent settlement
on this platform. Agents never compute route economics — they consume `POST /api/v1/routes`.

Treasury product comparison remains planned on the `treasury_product` rail.
