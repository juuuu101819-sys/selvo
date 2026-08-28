# Meridian — Production Audit

**Product:** Global non-custodial financial routing hub  
**Scope:** Existing repository only (Phases 0–19 as implemented)  
**Date:** 28 August 2026  
**Method:** Source review of `apps/`, `packages/`, `prisma/`, `tests/`, `docs/`, lockfile, and `npm audit --omit=dev`  
**Constraint:** PA-C01, PA-C02, PA-C03, PA-H01–PA-H13, PA-M01–PA-M06, PA-M08 (index + CI already ran postgres tests), PA-M11–PA-M16, PA-L01–PA-L04 (SCIM still out of scope; worker queue still out of scope) were subsequently fixed in production code. Remaining Medium and Low issues that require dedicated feature work (PA-M07, PA-M09 partner payouts / payment collection, PA-M10, PA-L05, PA-L06) remain unimplemented. Live execution remains unimplemented (501). PHASE 32 added invoice generation from monetization snapshots without enabling collection or execution. PHASE 33 (AI-agent payment pilot) was **not run**: the four business/legal gates were unconfirmed outside Cursor, so `POST /api/v1/executions` was left at 501.

Engine versions in this tree (must not be assumed bumped by a future phase):

| Engine | Constant | Version |
| ------ | -------- | ------- |
| Fiat comparison | `ENGINE_VERSION` | 2.0.0 |
| Multi-rail routing | `ROUTING_ENGINE_VERSION` | 1.0.0 |
| Route graph | `GRAPH_ENGINE_VERSION` | 1.0.0 |
| Stablecoin routing | `STABLECOIN_ROUTING_ENGINE_VERSION` | 1.0.0 |
| DeFi routing | `DEFI_ROUTING_ENGINE_VERSION` | 1.0.0 |

---

## Verdict

The codebase is a **sandbox-complete routing hub** with strong non-custodial structural controls and **no accidental custody, key generation, wallet control, or live execution path**.

It is **not production-ready** as a live financial service:

- Licensed partner adapters still do not exist; production now starts **read-only** with routing and execution independently unavailable (`docs/PRODUCTION_GATES.md`). Claiming `PRODUCTION_ROUTING_AVAILABLE=true` without a licensed adapter fails closed. Execution cannot be enabled.
- Persistence defaults to in-memory **only** in development/test; production-locked processes require PostgreSQL and reject demo credentials.
- `POST /api/v1/comparisons` ranks through the same MultiRailRouter as `POST /api/v1/routes` (`ROUTING_ENGINE_VERSION` 1.0.0). The fiat `ENGINE_VERSION` 2.0.0 constant remains for `/meta` and for `RouteComparisonService`, which is no longer reachable from HTTP.
- Partner execution and settlement are deliberately unimplemented (`POST /api/v1/executions` → 501).
- Authorization on agent policy and session scopes is least-privilege for owner/admin policy writes,
  role-derived session scopes, mandatory Policy Engine evaluation before execution intents, and
  atomic daily-spend reservation (PA-H01–H04). Routing consistency and financial-data integrity
  issues PA-H05–PA-H08 are fixed. Quote freshness and non-fiat platform-fee correctness
  (PA-H09–PA-H10) are fixed. CI, the Prisma `deepmerge-ts` advisory, and settlement-like status
  naming (PA-H11–PA-H13) are fixed. **All CRITICAL and HIGH issues from this audit are closed.**
  PA-M01–PA-M06, PA-M11, PA-M12, PA-M13, and PA-M15 are closed. PA-L04 (quote cache / circuit breaker) is closed. PA-M08, PA-M14, PA-M16, PA-L01, and PA-L02 are closed. PHASE 32 implemented invoice generation (PA-M09 invoices). Remaining Medium/Low items are feature-scale and deferred (payment collection, partner AP, cursor pagination, multi-rail fingerprint).

**Do not enable delegated execution, connect a chain, or collect customer funds until the production blockers in section D are closed.**

---

## Required verifications

### Non-custodial contract — PASS (no accidental custody found)

| Forbidden behaviour | Evidence |
| ------------------- | -------- |
| Hold customer funds | No balance/ledger table. `TransactionRequestStatus` has no settled/executed/funded value (`prisma/schema.prisma` lines 7–15, `docs/DATABASE.md`). `payment_intents` / `monetization_events` CHECKs force `funds_moved = false`. |
| Hold / generate private keys | No keystore, no `ethers`/`viem`/`web3`/`bitcoin` dependency. `holdPrivateKeys: false` (`packages/core/src/domain/capabilities.ts` line 18). Request bodies reject `privateKey` via Zod `.strict()`. |
| Control customer wallets | `AgentWalletReference.controlledByPlatform` is typed and CHECK-constrained to `false` (`prisma/schema.prisma` lines 379–394; migration `20260827140000_agent_payments`). |
| Execute real transactions | `POST /executions` audits then throws 501 (`apps/api/src/routes/executions.ts` lines 16–38). Simulator is in-process (`packages/core/src/engine/sandbox-simulator.ts` lines 9–27). All adapters are dataset/demo; no outbound HTTP. Chain registry `connected: false`, `rpcUrl: null` (`packages/core/src/domain/chain.ts` lines 32–35). |

`PLATFORM_CAPABILITIES.executeTransactions`, `delegateExecution`, `custodyFunds`, `holdCryptoAssets`, `holdPrivateKeys`, `controlCustomerWallets`, `operateAsPrincipal`, `defiExecution` are all `false`.

### Traditional FX / stablecoin / DeFi as equal rails — PASS on `/comparisons` ranking; catalog flags still split

Equal **inside** `MultiRailRouter` (`packages/core/src/engine/routing-engine.ts`): one `FinancialProvider` catalog, one `MultiRailCostEngine`, one scorer. `POST /api/v1/comparisons` is a facade over that same router (`ComparisonRoutingService`).

Residual catalog honesty (not a second ranker):

- `dex_liquidity` and family `defi` remain `planned` in `RAIL_REGISTRY` (`packages/core/src/domain/rail.ts`), so a `railFamilies: ['defi']` filter on `/comparisons` is still 400. `/defi-routes` quotes those venues directly.
- `treasury_product` has no adapter.
- Graph paths are still indicative topology, not priced routes (`packages/core/src/graph/service.ts`).

### AI agents use the deterministic routing engine — PASS

`AgentPaymentService.quoteIntent` calls `this.deps.routing.evaluate` (`MultiRailRouter`) (`packages/core/src/engine/agent-payment-service.ts` around lines 246–254).  
`NlRoutingService` types `financialsComputedBy: 'routing_engine'`, `aiUsed: false` (`packages/core/src/engine/nl-routing-service.ts` lines 50–58, 70–74).

### AI layer cannot invent financials — PASS

Parser contract (`packages/core/src/domain/optimization-preference.ts` lines 34–38):

```
NL_DID_NOT_COMPUTE = ['exchange_rates', 'fees', 'slippage', 'settlement_amounts']
```

`payment-instruction.ts` is a regex/merchant resolver, not a pricing engine. No balance lookup. Settlement status on NL results is typed `executable: false`, `submitted: false`, `fundsMoved: false`. `SIMULATION_COMPLETED` on the payment-intent path is **simulation only** (`sandbox-simulator.ts`).

### Decimal-safe financial calculations — PASS on the money path; display-only conversion at chart CSS

Core money: `bigint` minor units + `decimal.js` clone `Dec` with 34 digits (`packages/core/src/money/decimal.ts`, `money.ts`). Ingress via string major units (`apps/api/src/http/validation.ts`). Persistence uses `toFixed(0)`, never `toNumber()` (`packages/persistence/src/postgres/prisma-driver.ts` line 303). Monetization uses `bigint` (`packages/core/src/engine/monetization-engine.ts`).

**Exceptions (not quote engines):** web display helpers in `apps/web/src/lib/format.ts` format percents, bps, rates, and scores with a display-only `decimal.js` clone (PA-L01 FIXED). Dashboard metric aggregation and chart geometry use `Dec`/`bigint` (PA-H07). Settlement-time labels still use `Math.round` on seconds, which is not money.

### Demo providers cannot execute real transactions — PASS

Sandbox adapters: `licensing: 'unlicensed_sandbox'`, `modes: ['sandbox']`. Production registry refuses them (`packages/core/src/engine/provider-registry.ts` lines 60–89). Simulator never networks. `executable` / `submitted` CHECKs on `execution_intents`.

---

## Review of the 34 areas

| # | Area | Assessment |
| - | ---- | ---------- |
| 1 | Overall architecture | Acyclic monorepo (`web → api → adapters/persistence → core`). `/comparisons` and `/routes` share MultiRailRouter; graph not composed into prices. |
| 2 | Frontend | Next.js 16, server actions, no Execute control. Duplicate wire types. Display percents/bps/rates use Decimal (PA-L01 FIXED); dashboard/chart geometry is bigint-scaled (PA-H07). |
| 3 | Backend | Fastify 5, Zod, capability flags. Anonymous public quote surfaces vs authenticated `/quote`. |
| 4 | Database | PostgreSQL schema exists; **default driver is memory**. |
| 5 | Prisma schema | Strong non-custody conventions; CHECKs live in SQL migrations. No billing tables. |
| 6 | API design | `/api/v1` + deprecated `/v1`. Overlapping compare/route/quote/stablecoin/defi APIs. No OpenAPI. |
| 7 | Authentication | Session `mds_`, org key `mk_`, agent `mag_`. Invalid credentials 401. Passwords scrypt. |
| 8 | Authorization | Roles exist but policy PATCH ignores them. Sessions get every API scope. |
| 9 | Organization isolation | Queries keyed by principal `organizationId`. Cross-tenant 404 (tested). |
| 10 | API key security | Salted scrypt at rest, prefix lookup, scope CHECK. Legacy SHA-256 re-hashed on use until 2026-11-28 (PA-M01). |
| 11 | Financial calculations | Engines Decimal-safe. Dashboard averages use `Dec`/`bigint` (PA-H07). Display percents/bps/rates use Decimal (PA-L01 FIXED). |
| 12 | Decimal precision | `DECIMAL(38,0)` amounts, `DECIMAL(38,18)` rates. |
| 13 | Quote engine | `/comparisons` ranks via MultiRailRouter 1.0.0. Fiat `ENGINE_VERSION` 2.0.0 remains on `/meta` and in `RouteComparisonService` (not HTTP). Fingerprints + replay. |
| 14 | Multi-rail routing | 1.0.0 ranks tradfi+stablecoin+DeFi. Rail-configured freshness excludes expired quotes (PA-H09). `/comparisons` shares this engine. |
| 15 | Route graph | Demo topology only when `includeDemoAdapters` is true. Production / no licensed metadata → empty graph (PA-H06). Never executable. |
| 16 | Stablecoin abstraction | Helios ramp + Solstice rail. No RPC. USDT→KRW graph-only. |
| 17 | DeFi abstraction | Read-only DEX/AMM/aggregator. Ranked on `/comparisons` via MultiRailRouter when the corridor is quoted. `defiExecution: false`. |
| 18 | AI agent infrastructure | Issue/revoke, intents, NL, dashboard. Simulator, not partner. |
| 19 | Policy engine | Fail-closed for agents. Daily spend under-counts in-flight. Execution intents ungated. |
| 20 | Fee engine | Provider vs platform split; CustomerPricing applies to fiat, stablecoin, and DeFi corridors once per route (PA-H10). |
| 21 | Revenue analytics | Quoted ledger + org dashboard. `/routes` and `/comparisons` write `ROUTE_QUOTE` events. Realized revenue stays zero until settlement (unimplemented). |
| 22 | TPV analytics | `tpvMinorUnits` on monetization events; agent dashboard volume. |
| 23 | Referral system | 25% of platform revenue in `priceMonetization`. No partner payout rail (correct). |
| 24 | Audit logging | Append-only; closed event set. Failed logins not recorded. Anonymous actor is always `anonymous` (PA-M04). |
| 25 | Rate limiting | Shared counters on the persistence driver (PostgreSQL in production). Disabled in `NODE_ENV=test` unless overridden. |
| 26 | Error handling | Typed `AppError`; Fastify 4xx, Prisma, and provider payloads mapped to a safe DTO (PA-M03). |
| 27 | Secrets management | Env Zod; `SecretResolver` for `PROVIDER_*`. Demo secrets in source. |
| 28 | Demo/production separation | Production boot fail-closed for comparison registry. Demo seed sandbox-gated (PA-C02). Graph is demo-gated; production graph is empty until licensed metadata exists (PA-H06). |
| 29 | Testing coverage | 845 unit/integration; 46 e2e (Phase 19). Gaps: production boot, postgres-default CI. Viewer PATCH and daily-spend reservation covered by PA-H01–H04. |
| 30 | Performance | Per-request live quotes, no cache, 4s provider timeout. Fine for sandbox. |
| 31 | Scalability | Memory default; in-process limiter; JSON `quoted_routes` on intents. |
| 32 | Deployment configuration | `.env.example` present. No Dockerfile, no CI workflows, no `vercel.json`. |
| 33 | Dependency vulnerabilities | `npm audit --omit=dev`: 3 **high** via Prisma → `deepmerge-ts` GHSA-ggr8-5vv4-36mx. 0 critical. |
| 34 | Regulatory-risk boundaries | 501 + flags + CHECKs are the software boundary. Payment-intent statuses no longer use settlement-like names (PA-H13). KYC/sanctions not implemented (correct until Phase 7). |

---

## Issue catalog

Each issue: severity, file, line/component, problem, why it matters, recommended fix, priority.

Priority: **P0** = do before any production-labelled deploy of quoting; **P1** = before live licensed quotes; **P2** = before delegated execution; **P3** = later hardening.

---

### CRITICAL

#### PA-C01 — Production mode has no licensed adapters and cannot start

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/api/src/container.ts`; `packages/core/src/engine/provider-registry.ts`; `apps/api/src/config/env.ts`
- **Component:** `buildProviders` / `ProviderRegistry.create` / `PRODUCTION_ROUTING_AVAILABLE`
- **Problem:** `PLATFORM_MODE=production` registered an empty `RouteProvider` list. The registry then threw: production required at least one `licensed_partner` adapter. Zero licensed implementations exist in `packages/adapters`.
- **Fix:** Demo providers, demo catalog adapters, and the demo graph are never loaded in production. `PRODUCTION_ROUTING_AVAILABLE` and `PRODUCTION_EXECUTION_AVAILABLE` are independent. Default both false: the process may start read-only with an empty registry and meta `productionGates.executionAvailable === false`. `PRODUCTION_ROUTING_AVAILABLE=true` still fails closed (no licensed adapters are invented). `PRODUCTION_EXECUTION_AVAILABLE=true` is always a startup failure; `POST /executions` remains 501.
- **Tests:** `apps/api/src/production-gates.test.ts`, `apps/api/src/config/env.test.ts` (PA-C01), `packages/core/src/engine/provider-registry.test.ts` (`allowEmpty`), `packages/adapters/src/demo/financial-catalog.test.ts` (`includeDemoAdapters: false`)
- **Priority:** P1 (product); P0 as a named production blocker

#### PA-C02 — Demo tenants provision whenever `NODE_ENV` is not `test`

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/api/src/app.ts`; `apps/api/src/config/env.ts`; `packages/core/src/auth/production-credentials.ts`; `packages/core/src/auth/demo-tenant.ts`
- **Component:** `createApp` → `provisionDemoTenants` / `AUTH_SECRET`
- **Problem:** Documented password `MeridianDemo!2026` and agent secret `mag_demo_agent01_sandbox_only_not_production` are committed. Provision ran for `NODE_ENV=development` **and** `NODE_ENV=production`. Comments said sandbox-only; there was no production-locked gate. `prisma/seed.ts` wrote the same hashes.
- **Fix:** Production-locked processes (`NODE_ENV=production` or `PLATFORM_MODE=production`) never seed demo tenants, reject demo login with the generic 401, reject the documented agent secret, require an explicit `AUTH_SECRET` (≥32 characters, not a demo/default value), and refuse `SEED_DEMO_TENANTS=true`. The secret is never stored on `AppConfig` or logged. `prisma/seed.ts` refuses to run. Login UI shows demo credentials only when API `mode=sandbox`.
- **Tests:** `apps/api/src/config/env.test.ts` (PA-C02), `packages/core/src/auth/production-credentials.test.ts`, `apps/api/src/production-gates.test.ts` (provision + agent secret)
- **Priority:** P0

#### PA-C03 — In-memory persistence is the default, including for a “production” Node environment

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/api/src/config/env.ts`; `.env.example`
- **Component:** `loadConfig`
- **Problem:** `DATABASE_DRIVER` defaults to `memory`. There was no startup rule that production required `postgres`. Quotes, audit, intents, and sessions could die with the process.
- **Fix:** If `NODE_ENV=production` or `PLATFORM_MODE=production`, `DATABASE_DRIVER=memory` fails closed. Production requires `postgres` and `DATABASE_URL`. The driver is not switched automatically and does not fall back to memory. Development and test may still use memory.
- **Tests:** `apps/api/src/config/env.test.ts` (PA-C03): production+memory FAIL; production+postgres PASS config validation; development+memory allowed; test+memory allowed
- **Priority:** P0

---

### HIGH

#### PA-H01 — Any organization session role can PATCH agent payment policy

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/api/src/routes/dashboard.ts`; `apps/api/src/http/require-organization.ts`
- **Component:** `PATCH /api/v1/dashboard/agents/:id/policies`
- **Problem:** Handler called `requireOrganization` and only rejected `principal.kind === 'agent'`. `viewer` and `member` could raise spend limits or empty allow-lists.
- **Fix:** The route uses Fastify `capabilityPreHandler('agent_policy:write')` plus `requireCapability`. Only `owner`/`admin` sessions receive that capability at issuance. `viewer`/`member`, agent credentials, and organization keys are `403`. Every successful mutation writes `payment.policy.updated` with actor id, actor role, organization id, agent id, previous and new policy snapshots, and timestamp.
- **Tests:** `apps/api/src/routes/agent-dashboard.test.ts` — viewer PATCH 403; member PATCH 403; admin/owner PATCH 200 + audit row
- **Priority:** P0

#### PA-H02 — Session users receive every API scope, including `payment:*` and `transaction:create`

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/core/src/domain/api-scope.ts`; `apps/api/src/auth/identity-authenticator.ts`
- **Component:** `sessionScopesForRole` / `SESSION_SCOPES_BY_ROLE`
- **Problem:** Logged-in humans received a default blob of every API scope, including `payment:*` and `transaction:create`.
- **Fix:** Session scopes are derived from membership role at issuance. `viewer`/`member` receive `quote:read` and `route:read` only. `owner`/`admin` additionally receive `agent_policy:write`. `payment:*` stays on `mag_` credentials. `transaction:create` stays on explicitly minted organization keys. Protected mutations enforce capability via `capabilityPreHandler` middleware.
- **Tests:** `packages/core/src/domain/api-scope.test.ts` (exact per-role scope set); `apps/api/src/routes/agent-payments.test.ts` and `execution-intents.test.ts` (session `payment:create` / `transaction:create` → 403)
- **Priority:** P0

#### PA-H03 — `POST /execution-intents` skips the payment policy engine

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/api/src/routes/execution-intents.ts`; `packages/core/src/engine/agent-payment-service.ts`
- **Component:** `registerExecutionIntentRoutes` / `gateExecutionIntent`
- **Problem:** Only `transaction:create` and quote-expiry were checked. Combined with PA-H02, any session user could persist a route choice without Policy Engine evaluation.
- **Fix:** Quote expiry is still checked first. A `paymentIntentId` is then required; omitting it is `403 POLICY_DENIED` (`policy_required`). `gateExecutionIntent` re-evaluates policy fail-closed (missing policy, evaluation errors, and non-gated statuses all reject). Allowed statuses are `ROUTED`, `POLICY_APPROVED`, `SIMULATION_PENDING`, and `SIMULATION_COMPLETED`. Select, authorize, simulate, NL routing, and the HTTP execution-intent route all funnel through that gate or `assertPolicy`.
- **Tests:** `apps/api/src/routes/execution-intents.test.ts`; `apps/api/src/routes/policy-hardening.test.ts` (API, service, NL, missing policy)
- **Priority:** P0

#### PA-H04 — Daily spending limit ignores in-flight intents

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/core/src/domain/agent-payments.ts`; `packages/core/src/engine/agent-payment-service.ts`; persistence agent-payment stores
- **Component:** `DAILY_SPENDING_STATUSES` / `withExclusiveAgentAccess`
- **Problem:** Only later lifecycle statuses counted. Concurrent `QUOTED` intents could each pass the daily check and then select in parallel.
- **Fix:** `ROUTED` is reserved spend. Select, authorize, simulate, and the execution-intent gate run inside `withExclusiveAgentAccess` (in-process mutex in memory; `SELECT … FOR UPDATE` on the agent policy row in Postgres). Check-and-reserve is a single locked operation; `excludeIntentId` prevents double-counting a row already reserved. `FAILED`/`EXPIRED` are omitted from the status set, so those transitions release the reservation. `SIMULATION_COMPLETED` keeps the amount as permanent spend.
- **Tests:** `apps/api/src/routes/policy-hardening.test.ts` — five parallel 400-unit intents against a 1,000-unit cap, six rounds; exactly two succeed each round
- **Priority:** P0 (control correctness); P2 (money impact)

#### PA-H05 — Dual quote engines; FX / stablecoin / DeFi are not one rail on `/comparisons`

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/api/src/container.ts`; `apps/api/src/routes/comparisons.ts`; `packages/core/src/engine/comparison-routing-service.ts`; `packages/core/src/engine/comparison-from-routing.ts`; `packages/core/src/engine/routing-snapshot.ts`
- **Component:** `ComparisonRoutingService` / `MultiRailRouter`
- **Problem:** Fiat comparison 2.0.0 (`RouteComparisonService` + `RouteCostEngine`) and multi-rail 1.0.0 (`MultiRailRouter`) ranked the same corridor independently. Clients could get two “best” routes or miss catalog venues that `/routes` already priced.
- **Fix:** Every `/comparisons` HTTP response is produced by `ComparisonRoutingService`, which calls `MultiRailRouter.evaluate` and maps the result to the existing comparison DTO. `container.comparisons` is that service; `RouteComparisonService` is not constructed in the API container and is not imported by the route handler. Replay re-prices stored MultiRail snapshots (`recomputeFromSnapshot`); a legacy fiat snapshot is reported as `engine_version_changed` rather than re-ranked by the old engine. Comparison `engineVersion` on the wire is `ROUTING_ENGINE_VERSION` (`1.0.0`). The fiat constant `ENGINE_VERSION` (`2.0.0`) is unchanged and still appears on `/meta`.
- **Tests:** `apps/api/src/routes/comparisons-multirail.test.ts` — handler/container must not mention `RouteComparisonService`; a fixed USD 100,000 → KRW fixture returns identical provider ranking and cost minor units on `/comparisons` and `/routes`; two identical comparison requests match. Existing comparison, routing, and e2e CASE 1 tests expect engine `1.0.0`.
- **Priority:** P1

#### PA-H06 — Route graph is always the demo topology

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/core/src/graph/build-graph.ts`; `apps/api/src/container.ts`
- **Component:** `buildFinancialRouteGraph` / `RouteGraphService`
- **Problem:** Graph construction always used `buildDemoFinancialGraph()`, including graph-only demo venue `demo-peninsula-settlement`, even when demo adapters were disabled.
- **Fix:** `buildFinancialRouteGraph({ includeDemoAdapters, licensedVenueMetadata })` is the only constructor the container uses. Sandbox sets `includeDemoAdapters: true` and loads the demo topology. Production sets `includeDemoAdapters: false` and `licensedVenueMetadata: []`. Missing licensed metadata returns an empty graph — never a silent demo fallback. Tests may inject licensed venue metadata; that metadata is not a licensed adapter and is never invented in production.
- **Tests:** `packages/core/src/graph/build-graph.test.ts` — demo on → demo nodes; demo off + no metadata → empty; demo off + licensed fixture → only that fixture.
- **Priority:** P1

#### PA-H07 — Dashboard and chart code coerce financial figures through IEEE `Number`

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/persistence/src/dashboard/aggregate.ts`; `apps/web/src/lib/chart-display.ts`; `apps/web/src/components/dashboard/charts.tsx`; `apps/web/src/components/cost-comparison.tsx`
- **Component:** `aggregateMetrics` / volume and cost bars
- **Problem:** `Number(quote.totalCostBps)` and `Number(point.minorUnits)` were used for dashboard averages and bar widths. Quote engines themselves stayed on `Dec`/`bigint`.
- **Fix:** Bps averages use `Dec`/`toDecimal` with four decimal places. Volume and savings stay on `bigint` minor units. Chart bar percentages are computed from bigint (or 4 d.p. scaled decimals) in `chart-display.ts`; the only `Number()` is a 0–100 CSS width at the rendering boundary, commented as display-only. Quote-count bars are not financial amounts.
- **Tests:** `packages/persistence/src/dashboard/aggregate.test.ts` — notional `2^53+1` (`9007199254740993`) and Decimal bps means; `apps/web/src/lib/chart-display.test.ts` — bar width past the IEEE integer boundary.
- **Priority:** P1

#### PA-H08 — Monetization events are not recorded on the multi-rail / stablecoin / DeFi HTTP surfaces

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/api/src/monetization/record.ts`; `apps/api/src/routes/routing.ts`; `apps/api/src/routes/comparisons.ts`; `apps/api/src/routes/execution-intents.ts`; `packages/core/src/engine/monetization-engine.ts`; `packages/core/src/domain/monetization.ts`
- **Component:** `recordRouteQuoteMonetization` / `priceRouteMonetization` / `ECONOMIC_STAGES`
- **Problem:** TPV and take-rate dashboards missed `/routes`. A route search could be mistaken for realized revenue if hooked naively.
- **Fix:** `/routes` reuses the same Decimal monetization calculation as the comparison/quote flow (`priceRouteMonetization` / `monetizationFromMultiRailRoute`) and returns that metadata on the DTO (`provider cost`, platform fee, partner commission, gross margin, take rate, TPV). Authenticated discovery writes an auditable `ROUTE_QUOTE` (`economicStage: 'route_quote'`, `realizedRevenue: false`, `fundsMoved: false`). There is no route-selection HTTP surface, so no `route_selected` snapshot is created. An execution intent writes `economicStage: 'execution_intent'` with the same unrealized flags; fees are not invented when no live priced route is supplied. Nothing in this tree writes `economicStage: 'settled'` or sets `realizedRevenue: true`. PHASE 32 invoices copy those snapshots and set `revenueRecognition: invoiced`; `realizedRevenue` remains false because payment collection is deferred (`collected` is never written). `POST /api/v1/executions` remains 501. Aggregation counts realized revenue only for `settled` events, so realized totals stay `0`.
- **Tests:** `apps/api/src/routes/routing-monetization.test.ts` (A–G); `packages/core/src/engine/monetization-engine.test.ts` — settled vs quote/intent; large-TPV Decimal identity.
- **Priority:** P1

#### PA-H09 — Multi-rail quoting does not apply comparison-grade freshness

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/core/src/quotes/rail-freshness.ts`; `packages/core/src/quotes/quote-selection.ts`; `packages/core/src/engine/quote-admission.ts`; `packages/core/src/engine/routing-engine.ts`; `packages/core/src/engine/agent-payment-service.ts`
- **Component:** `MultiRailRouter` / `admitNormalizedQuote`
- **Problem:** Fiat comparisons called `assertQuoteUsable`. Multi-rail and agent quotes did not. A DEX price that had already expired could be ranked next to a still-valid bank FX quote, and a stale recommended quote could still be selected.
- **Fix:** Every normalised quote must carry `timestamp` and `expiresAt`. Rail-configured freshness windows (`RAIL_FRESHNESS_POLICY`: bank FX 120s, stablecoin 45s, DEX 12s) are applied at ingestion and again at ranking. A quote past `expiresAt` or older than the rail max-age becomes a per-provider failure (`QUOTE_EXPIRED` / `QUOTE_STALE`), never a ranked option. Comparison and `/routes` DTOs expose `quote.freshness` / `quoteFreshness` (`ageMs`, `ageSeconds`, `state`). Selecting a route or recording an execution intent against an expired quote throws `QUOTE_EXPIRED` with `requoteRequired: true`. Replay does not re-apply the live admission check.
- **Tests:** `packages/core/src/engine/routing-engine.test.ts` — expired DEX excluded, valid FX ranked; age metadata on all three rails. `packages/core/src/quotes/quote-selection.test.ts` and `apps/api/src/routes/quote-freshness-selection.test.ts` — select after expiry is 409 with `requoteRequired`.
- **Priority:** P1

#### PA-H10 — Customer platform pricing is skipped on non-fiat multi-rail corridors

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/core/src/engine/routing-engine.ts`; `packages/core/src/engine/routing-cost.ts`; `packages/core/src/domain/platform-pricing.ts`
- **Component:** `MultiRailRouter.loadPricingRules` / `MultiRailCostEngine` / `priceRouteMonetization`
- **Problem:** `CustomerPricing` applied on fiat↔fiat. Stablecoin and DeFi legs received no platform fee, so take-rate was incomplete for two of three rails.
- **Fix:** The same `selectPricingRule` / `MultiRailCostEngine` path loads and applies negotiated terms for any corridor (fiat, stablecoin, DeFi) when an organisation has terms. Platform markup is charged once on the customer notional, not multiplied by hop count. Provider, network, gas, and liquidity costs remain per-leg. A configured DeFi/cross-chain surcharge is an explicit `surcharge` fee component (`defi_surcharge`), never implied by take-rate × legs. Memory still charges zero when no resolver/terms exist. Arithmetic stays on `Dec`/`bigint` across 2-, 6-, and 18-decimal assets. Monetization still uses `priceRouteMonetization` — no second fee engine.
- **Tests:** `packages/core/src/engine/routing-platform-fees.test.ts` — A–G: equivalent fiat vs stablecoin-assisted take-rate; DeFi multi-hop per-leg costs + one platform fee; 1-leg vs 3-leg same platform fee; identifiable surcharge; Decimal reconciliation; 6- and 18-decimal precision; repeated calculation does not compound.
- **Priority:** P1

#### PA-H11 — No CI, container, or deploy manifest

- **Status:** **FIXED** (2026-08-28)
- **File:** `.github/workflows/ci.yml`; `Dockerfile`; `.dockerignore`; `package.json` (`audit:deps`); `README.md`
- **Component:** CI / production image
- **Problem:** `npm run verify` and Playwright existed locally only. A regression in PHASE 20–22 financial-safety properties could merge without automated verification. No production container, and `npm install` could drift from the lockfile.
- **Fix:** GitHub Actions workflow `.github/workflows/ci.yml` runs on every push and pull request with no `continue-on-error`. Jobs: (1) `npm ci`, Prisma migrate against CI Postgres, `lint`, `typecheck`, unit+integration (including `TEST_DATABASE_URL` persistence tests), `npm run audit:deps`; (2) production build + Playwright e2e; (3) `docker build --target api` of a fail-closed production image (`NODE_ENV=production`, `PLATFORM_MODE=production`, `DATABASE_DRIVER=postgres`, routing/execution flags false, no baked `AUTH_SECRET` or demo credentials). README documents the workflow path.
- **Tests:** `apps/api/src/ops/ci-hardening.test.ts` — workflow contains `npm ci`, verify, e2e, audit, docker build, and no `continue-on-error`; Dockerfile matches PA-C01–C03 gates.
- **Priority:** P0 for process; P1 for images

#### PA-H12 — Prisma `deepmerge-ts` high advisory (GHSA-ggr8-5vv4-36mx)

- **Status:** **FIXED** (2026-08-28)
- **File:** `package.json` `overrides.deepmerge-ts`; `package-lock.json`; `.github/workflows/ci.yml` (`npm run audit:deps`)
- **Component:** Prisma CLI config merge (`prisma@7.10.0` → `@prisma/config` → `deepmerge-ts`)
- **Problem:** `npm audit` reported 3 high findings, all GHSA-ggr8-5vv4-36mx / CVE-2026-40345 (stack exhaustion on recursive object graphs). `deepmerge-ts < 8.0.0` was pinned at `7.1.5` by `@prisma/config@7.10.0`. `npm audit fix` wanted to downgrade Prisma 7 → 6. Prisma 7.10.0 was still the latest stable; the upstream bump in prisma/prisma#30054 had not shipped.
- **Fix:** Root `overrides` pins `deepmerge-ts` to **8.0.2** (patched ≥ 8.0.0) without changing Prisma 7.10.0. `npm audit --audit-level=moderate` is clean. CI runs that audit on every change so a new moderate-or-higher advisory fails the pipeline. Prefer removing the override once Prisma publishes `@prisma/config` with `deepmerge-ts >= 8`.
- **Tests:** `apps/api/src/ops/ci-hardening.test.ts` asserts the override and the CI audit step. Persistence integration tests still run when `TEST_DATABASE_URL` is set.
- **Priority:** P1

#### PA-H13 — Payment statuses `AUTHORIZED` / `EXECUTION_PENDING` / `COMPLETED` read as settlement

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/core/src/domain/agent-payments.ts`; `packages/core/src/domain/financial-status.ts`; `packages/core/src/engine/agent-payment-service.ts`; `docs/API.md`; `prisma/migrations/20260828120000_payment_intent_status_rename/migration.sql`
- **Component:** payment-intent / execution-intent lifecycle
- **Problem:** Simulator set `COMPLETED` with `fundsMoved: false`. `AUTHORIZED` and `EXECUTION_PENDING` matched licensed payment-rail vocabulary, so API consumers could read simulation as settlement.
- **Fix:** Atomic rename (old names fully removed, no alias): `AUTHORIZED` → `POLICY_APPROVED`, `EXECUTION_PENDING` → `SIMULATION_PENDING`, `COMPLETED` → `SIMULATION_COMPLETED`. Execution-intent status remains `recorded` (not a payment). A catalog in `financial-status.ts` states that every API-reachable financial status implies `fundsMoved: false` and realized revenue `false`. `docs/API.md` lists each value with a one-line financial meaning. Postgres CHECK is migrated in lockstep. `POST /api/v1/executions` remains 501.
- **Tests:** `packages/core/src/domain/financial-status.test.ts`; `apps/api/src/ops/status-documentation.test.ts` — every catalog status has an API.md row with realized revenue `no`; retired names are absent.
- **Priority:** P1 (appearance); P2 (before external developers)

---

### MEDIUM

#### PA-M01 — Unsalted SHA-256 for API keys, agent secrets, and session tokens

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/core/src/crypto/secrets.ts`; `apps/api/src/auth/identity-authenticator.ts`
- **Component:** `hashCredential` / `verifyAndUpgradeCredential` / `hashSessionToken`
- **Problem:** High-entropy tokens hashed with unsalted SHA-256. Passwords correctly use scrypt (lines 31–38).
- **Why it matters:** DB dump + token reuse is easier to brute than a KDF. Mitigated by 32-byte random secrets.
- **Fix:** API keys and agent `mag_` secrets use per-secret salted scrypt (`hashCredential`), verified with the KDF compare (`timingSafeEqual` on derived keys). The raw secret is returned once on issue; subsequent list views expose only `keyPrefix`. Session tokens use HMAC-SHA-256 with a pepper derived from `AUTH_SECRET` (never stored on `AppConfig`) because sessions are looked up by hash. Legacy unsalted SHA-256 hashes remain verifiable until first successful use, at which point they are immediately re-hashed; leftover SHA-256 verification is refused after `2026-11-28T00:00:00.000Z`. Newly issued credentials never use SHA-256.
- **Tests:** `packages/core/src/crypto/secrets.test.ts`; `apps/api/src/http/phase24-security.test.ts`
- **Priority:** P1

#### PA-M02 — In-process rate limiter

- **Status:** **FIXED** (2026-08-28) — Option B, shared backend
- **File:** `apps/api/src/http/rate-limit.ts`; `packages/persistence/src/rate-limit/`
- **Component:** `registerRateLimiting` / `RateLimitStore`
- **Problem:** Per-process `Map` keyed by org or IP. No shared store. Restarts reset buckets.
- **Why it matters:** Multiple replicas multiply quota; anonymous `/comparisons` is IP-only.
- **Fix:** Counters live on the persistence driver. Production (`DATABASE_DRIVER=postgres`, required by PA-C03) uses table `rate_limit_buckets` with an atomic `INSERT … ON CONFLICT` so every replica shares the window and a restart does not reset the distributed limit. The memory driver keeps an in-process map (single process by definition). There is no Redis in this repository; this is the roadmap's "Redis-based rate limit" item implemented on the existing shared store rather than a second backend. Identity precedence: verified API-key/agent/user `subjectId`, then IP for anonymous callers. Exceeding the limit returns HTTP 429 with `Retry-After`.
- **Tests:** `apps/api/src/routes/rate-limit.test.ts`; `packages/persistence/src/rate-limit/fixed-window.test.ts`
- **Priority:** P1

#### PA-M03 — Fastify 4xx messages forwarded to clients

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/api/src/http/errors.ts`; `apps/api/src/http/public-error.ts`
- **Component:** `setErrorHandler` / `toPublicErrorResponse`
- **Problem:** Non-`AppError` 4xx uses `error.message`. 5xx is opaque (good).
- **Why it matters:** Parser wording leakage (payload size, content-type).
- **Fix:** Every client error uses `{ error: { code, message, details, requestId } }`. Fastify 4xx, non-operational `AppError`, Prisma-shaped failures, and upstream provider payloads are mapped to a generic message with empty details. Server logs retain the original exception under the same `requestId`. Designed validation messages remain.
- **Tests:** `apps/api/src/http/public-error.test.ts`
- **Priority:** P2

#### PA-M04 — Spoofable audit actor on anonymous requests

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/api/src/auth/identity-authenticator.ts`; `apps/api/src/auth/anonymous-authenticator.ts`
- **Component:** anonymous principal / `X-Meridian-Actor`
- **Problem:** Unauthenticated callers can set `actor` on audit rows (e.g. execution 501).
- **Why it matters:** Audit integrity, not fund movement.
- **Fix:** `actor` is taken only from the verified session, API key, or agent credential. Anonymous callers are always `"anonymous"`. `X-Meridian-Actor` and body fields such as `actorId` / `performedBy` are ignored for audit (strict request schemas also reject unknown identity fields). Every `AuditLog` write path already used `principal.actor` (or `'system'` / `'provision'`); fixing the principal fixes the writes.
- **Tests:** `apps/api/src/http/authentication.test.ts`; `apps/api/src/http/phase24-security.test.ts`; `apps/api/src/routes/executions.test.ts`
- **Priority:** P2

#### PA-M05 — Overlapping public vs authenticated quote APIs; no OpenAPI

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/api/src/openapi/catalog.ts`; `apps/api/src/routes/openapi.ts`; `docs/API.md`; `GET /api/v1/meta` `apiSurfaces`
- **Component:** `/comparisons`, `/routes`, `/quote`, `/stablecoin-routes`, `/defi-routes`
- **Problem:** `/quote` requires `quote:read`; `/routes` is anonymous and uses the same multi-rail engine. Web restates DTOs in `apps/web/src/lib/api/types.ts`.
- **Why it matters:** Auth bypass by using the public twin; contract drift.
- **Fix:** Surfaces are classified in one catalog. Public discovery (`/comparisons`, `/routes`, stablecoin/DeFi/catalog quotes) stays anonymous and indicative. Authenticated `POST /quote` (`quote:read`) is the org-scoped billed window (`quoteExpiresAt`); anonymous is 401. Public `/routes` still returns quoted, unrealized monetization (`realizedRevenue: false`, `fundsMoved: false`) — PA-H08 is unchanged. `GET /api/v1/openapi.json` serves OpenAPI 3.0.3 generated from the catalog. A coverage test requires every implemented `/api/v1` route to appear in the spec.
- **Tests:** `apps/api/src/openapi/openapi.test.ts`; `apps/api/src/routes/api-surface.test.ts`
- **Priority:** P1

#### PA-M06 — Docs still say agents are not issued

- **Status:** **FIXED** (2026-08-28)
- **File:** `docs/AGENTS.md`; `docs/ARCHITECTURE.md`; `docs/MASTER_PRODUCT_DEFINITION.md`; `docs/API.md`
- **Component:** documentation
- **Problem:** `POST /api/v1/agents` issues `mag_` credentials (`apps/api/src/routes/agent-payments.ts`).
- **Why it matters:** Operators following architecture text will mis-assess the attack surface.
- **Fix:** Architecture §0 and the master product definition now state that sandbox `mag_` credentials are issued. `docs/AGENTS.md` documents create, `DEFAULT_AGENT_SCOPES`, difference from `mds_` / `mk_`, and revoke-then-reissue (there is no rotate-in-place endpoint — that gap is explicit). Issuance code was not changed.
- **Tests:** `apps/api/src/routes/agent-payments.test.ts` — prefix, scopes, one-time secret
- **Priority:** P1

#### PA-M07 — List pagination is limit-only

- **Status:** **DEFERRED** (feature-scale — cursor pagination across dashboard lists)
- **File:** `apps/api/src/http/validation.ts` (`listQuerySchema`, ~lines 117–118)
- **Component:** dashboard and intent lists
- **Problem:** `limit` 1–100, no cursor. Default dashboard page size 50.
- **Why it matters:** Large tenants cannot page stably.
- **Recommended fix:** Cursor pagination on quotes, intents, comparisons.
- **Priority:** P2
- **Deferred because:** New list protocol (cursors on quotes, intents, comparisons) is a product API change, not a smallest-possible cleanup.

#### PA-M08 — Postgres integration tests are opt-in; daily-spend query under-indexed

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/persistence/src/postgres/prisma-driver.integration.test.ts`; `prisma/schema.prisma` (`payment_intents` indexes); `packages/persistence/src/postgres/prisma-agent-payments.ts` (`sumDailySpending`); `.github/workflows/ci.yml`
- **Component:** CI / indexes
- **Problem:** Tests skip without `TEST_DATABASE_URL`. Daily sum filters status + asset + timestamps without a matching composite index.
- **Why it matters:** CHECK/migration regressions and slow policy checks under load.
- **Before:** `sumDailySpending` filtered `organizationId`, `agentId`, `sourceAsset`, `status`, and an `authorizedAt`/`createdAt` window with only `(organization_id, created_at)` and `(organization_id, agent_id, created_at)` indexes. CI already set `TEST_DATABASE_URL` (PA-H11).
- **After:** Composite indexes `payment_intents_daily_spend_authorized_idx` and `payment_intents_daily_spend_created_idx` on `(organization_id, agent_id, source_asset, status, authorized_at|created_at)`. CI postgres job unchanged. Query logic unchanged.
- **Tests:** `packages/persistence/src/postgres/prisma-driver.test.ts`; `prisma-driver.integration.test.ts` (gated on `TEST_DATABASE_URL`)
- **Priority:** P1

#### PA-M09 — No invoices, subscriptions, or partner-payout tables

- **Status:** **PARTIAL** (2026-08-28) — invoices implemented; collection and partner AP deferred
- **File:** `prisma/schema.prisma` (`Invoice`, `InvoiceLine`, `MonetizationEvent.revenueRecognition`); `packages/core/src/engine/billing-engine.ts`; `apps/api/src/routes/billing.ts`
- **Component:** billing
- **Problem:** Referral/commission is an attributed field, not accounts payable. `enterprise_api_subscription` is a seeded demo event. There was no invoice table.
- **Why it matters:** Business model (API fees, enterprise fees, partner commissions) was not operable as billed revenue.
- **After (PHASE 32):** Monthly invoices are generated exclusively from existing monetization snapshots (copied `platformRevenueMinorUnits`, line items name snapshot IDs). Billable events are `execution_intent` and `enterprise_subscription` with positive platform revenue. `route_quote` is never billed. Unique `(organization, period, currency)` and unique line `monetization_event_id` prevent double-billing. `revenueRecognition` becomes `invoiced`; `realizedRevenue` stays false until `collected`, which is never written. Tax is always 0. Issuer legal entity is `unconfirmed`. `DeferredPlatformFeeCollector` does not collect. Partner commission remains an attributed field, not accounts payable.
- **Tests:** `packages/core/src/engine/billing-engine.test.ts`; `apps/api/src/routes/billing.test.ts`
- **Priority:** P2
- **Still deferred:** live payment collection, tax calculation, issuer legal entity, partner payouts as AP.

#### PA-M10 — Multi-rail results have no comparison-style fingerprint/replay

- **Status:** **DEFERRED** (feature-scale — public snapshot would require a new engine version)
- **File:** `packages/core/src/engine/routing-engine.ts`; fingerprints in `packages/core/src/reproducibility/fingerprint.ts` used by comparison service
- **Component:** reproducibility
- **Problem:** Agent intents hash create-payload for idempotency, not provider quotes. `/routes` has `routingId` only.
- **Why it matters:** Disputes on multi-rail quotes cannot replay like `/comparisons/:id/replay`.
- **Recommended fix:** Snapshot + fingerprint multi-rail evaluations (new engine version if the snapshot shape is public).
- **Priority:** P2
- **Deferred because:** A public multi-rail snapshot/fingerprint is a new reproducibility surface and must not bump `ROUTING_ENGINE_VERSION` in this cleanup phase.

#### PA-M11 — `preferredRoutePreference` is not a policy rule

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/core/src/domain/payment-policy.ts`; `packages/core/src/engine/agent-payment-service.ts`
- **Component:** policy engine / agent quote
- **Problem:** Stored and shown on the dashboard; `evaluatePaymentPolicy` does not enforce it.
- **Why it matters:** Operators may believe agents are locked to lowest-cost.
- **Fix:** Policy `preferredRoutePreference` is the ranking-weight input to the existing `MultiRailRouter.evaluate` (intent preference is used only when the policy field is null). After ranking, allowlists still filter; an empty or non-matching allowlist is `POLICY_DENIED` (`allowed_providers`) with `allowedRouteCount: 0` — the preference is never silently ignored. On select, a non-recommended route is `preferred_route_preference` when the policy field is set. Public `/routes` is unchanged (no payment policy).
- **Tests:** `packages/core/src/domain/payment-policy.test.ts`; `apps/api/src/routes/route-preference.test.ts`
- **Priority:** P2

#### PA-M12 — Cookie `secure` is off unless `COOKIE_SECURE=true`

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/web/src/lib/session-cookie.ts`; `apps/web/src/lib/session.ts`
- **Component:** session cookie
- **Problem:** Default `secure: false` for local HTTP. Easy to forget in HTTPS production.
- **Why it matters:** Session cookie theft on mixed-content or HTTPS deploys.
- **Fix:** `HttpOnly=true`, `SameSite=Lax` (login is same-site POST; Strict would break email links into `/dashboard`). `Secure` is required when `PLATFORM_MODE=production` and cannot be set false (startup throw). `NODE_ENV=production` defaults Secure on. Playwright's HTTP server sets `COOKIE_SECURE=false` without `PLATFORM_MODE=production`. Request headers such as `X-Forwarded-Proto` are never read.
- **Tests:** `apps/web/src/lib/session-cookie.test.ts`
- **Priority:** P1

#### PA-M13 — Next middleware only checks cookie presence

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/web/src/middleware.ts`; `apps/web/src/lib/session-gate.ts`; `apps/web/src/lib/protected-routes.ts`
- **Component:** `/dashboard` gate
- **Problem:** Any non-empty `meridian_session` cookie reaches the dashboard; API then rejects.
- **Why it matters:** Extra round-trip, not a data leak if server actions always hit the API (they do).
- **Before:** Presence-only check. Garbage cookies reached `/dashboard` and were rejected later by `GET /auth/me`.
- **After:** One middleware gate on every `/dashboard` route. Missing, malformed, expired, and API-rejected cookies all produce the same client-visible outcome: PA-M03 `401 UNAUTHENTICATED` (`Sign in to continue.`, empty `details`) for programmatic JSON, or a generic `/login` redirect for document navigation. The response never distinguishes expired vs malformed vs missing. Format-invalid cookies are rejected without calling the API. Well-formed `mds_` tokens are verified with `GET /api/v1/auth/me` (fail-closed on timeout or transport error). Not a substitute for API auth.
- **Tests:** `apps/web/src/lib/session-gate.test.ts`; `apps/web/src/middleware.test.ts` — every dashboard `page.tsx` enumerated; no cookie and tampered cookie both 401.
- **Priority:** P3

#### PA-M14 — Auto-created “wallet” reference on agent issue

- **Status:** **FIXED** (2026-08-28) for wording. Making the reference optional remains deferred.
- **File:** `apps/api/src/routes/agent-payments.ts`; `docs/AGENTS.md`; `apps/api/src/openapi/catalog.ts`
- **Component:** `POST /agents`
- **Problem:** Synthetic `external_account` / `ext_acct_*` handle. `controlledByPlatform` remains false.
- **Why it matters:** Wording can look like wallet provisioning.
- **Before:** Handler already stored `kind: 'external_account'` and label “External operating account”, but docs/OpenAPI/`GET /agents/me` still said “wallet”.
- **After:** User-facing copy (AGENTS.md, OpenAPI catalog, agents page, DTO comment) calls it an **external account reference**. JSON keys and `/agents/:id/wallets` path are unchanged (breaking API). The row is still always created on mint; making it optional would change product issuance.
- **Tests:** `apps/api/src/routes/agent-payments.test.ts` — `kind`, label, `controlledByPlatform: false`, `ext_acct_*`
- **Priority:** P2

#### PA-M15 — Failed authentication is not an audit event

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/api/src/routes/auth.ts`; `apps/api/src/http/authentication.ts`; `apps/api/src/http/auth-failure-audit.ts`; `packages/core/src/ports/audit.ts`
- **Component:** login and presented credentials
- **Problem:** Brute force is not in the financial audit log (rate limit may still apply).
- **Why it matters:** Security monitoring gap.
- **Before:** Failed login and unverifiable Bearer/API-key/agent credentials returned 401 with no audit row.
- **After:** Every failed login appends `auth.login.failed` (hashed email identifier, source IP, category `login_failed`). Every presented-but-unverifiable credential appends `auth.credential.failed` with a reason category (`invalid_session` / `invalid_api_key` / `invalid_agent` / `malformed_credential`). Raw passwords, session tokens, and API-key/agent secrets are never written. Public `mk_`/`mag_` 16-character prefixes may appear; `mds_` tokens do not. No lockout, CAPTCHA, or extra throttle — observability only.
- **Tests:** `apps/api/src/http/auth-failure-audit.test.ts` — N failed logins produce N events; payloads contain no raw credential.
- **Priority:** P2

#### PA-M16 — `parseApiScopes` silently drops unknown strings

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/core/src/domain/api-scope.ts`; `apps/api/src/routes/api-keys.ts`; `apps/api/src/http/validation.ts` (`createApiKeySchema`)
- **Component:** key issuance
- **Problem:** Invalid scope names are skipped rather than 400.
- **Why it matters:** Operator may think a key has a right it does not.
- **Before:** `parseApiScopes` `continue`d on unknown strings. Org-key Zod already constrained known names; issuance still called the dropping parser.
- **After:** Issuance uses `parseApiScopesStrict`, which throws `VALIDATION_ERROR` on unknown names (e.g. `execute`). Stored-row hydration still uses lenient `parseApiScopes` so leftover strings cannot crash auth. Org-key Zod enum is unchanged.
- **Tests:** `packages/core/src/domain/api-scope.test.ts`; `apps/api/src/routes/api-keys.test.ts`
- **Priority:** P3

---

### LOW

#### PA-L01 — Display-only `Number()` in the web app

- **Status:** **FIXED** (2026-08-28)
- **File:** `apps/web/src/lib/format.ts`; `apps/web/src/lib/display-decimal.ts`; `apps/web/src/components/cost-comparison.tsx`; `apps/web/src/components/route-card.tsx`
- **Component:** UI formatting
- **Problem:** Percent, bps, and score strings converted with `Number()` for presentation. Amounts correctly use integer minor units in `format.ts`.
- **Why it matters:** Typical USD bps are safe; not a quote-engine bug.
- **Before:** `formatPercent`, `formatBps`, `formatRate`, and `formatReliability` used IEEE `Number()`.
- **After:** Those helpers parse with a display-only `decimal.js` clone matching core `Dec` settings. Invalid strings are returned unchanged. Quote engines and dashboard aggregates are untouched (PA-H07).
- **Tests:** `apps/web/src/lib/format.test.ts`
- **Priority:** P3

#### PA-L02 — `ExecutionIntent.status` is a free `String` in Prisma

- **Status:** **FIXED** (2026-08-28)
- **File:** `prisma/schema.prisma` (`ExecutionIntent.status`); migration `20260828160000_phase28_status_enum_daily_spend_idx`
- **Component:** `ExecutionIntent`
- **Problem:** Domain + SQL CHECK force `recorded`; Prisma layer is weaker.
- **Why it matters:** Accidental new statuses in application code before a migration.
- **Before:** `status String @default("recorded")` plus CHECK `"status" = 'recorded'`.
- **After:** Prisma/Postgres enum `ExecutionIntentStatus { recorded }`. Existing CHECK constraints remain. HTTP execution-intent behaviour unchanged; `POST /executions` stays 501.
- **Tests:** `packages/persistence/src/postgres/prisma-driver.test.ts`; `prisma-driver.integration.test.ts`
- **Priority:** P3

#### PA-L03 — No SSO, MFA, SCIM

- **Status:** **FIXED** (2026-08-28) for TOTP MFA and org-level OIDC. **SCIM remains out of scope.**
- **File:** `docs/AUTH.md`; `apps/api/src/routes/auth.ts`; `apps/api/src/routes/auth-mfa.ts`; `apps/api/src/routes/auth-oidc.ts`; `packages/core/src/crypto/encryption.ts`; `packages/core/src/crypto/totp.ts`
- **Component:** identity
- **Problem:** Email/password + API keys only. Documented out of scope.
- **Why it matters:** Enterprise buyers.
- **Before:** Architecture §10 listed SSO/MFA as absent. Login always issued a session after password check.
- **After:** Optional TOTP (AES-256-GCM secret, scrypt recovery codes, org flag for owner/admin, off by default). Generic OIDC (encrypted client secret, existing `OrganizationMember` mapping only, unmapped identity rejected). Both issue the same PA-H02 `mds_` session via `issueHumanSession`. Password login unchanged when MFA/SSO are off. SCIM is not implemented.
- **Tests:** `apps/api/src/routes/auth-mfa-sso.test.ts`; `packages/core/src/crypto/encryption.test.ts`; `packages/core/src/crypto/totp.test.ts`; `packages/core/src/crypto/recovery-codes.test.ts`
- **Priority:** P3

#### PA-L04 — No quote cache, circuit breaker, or worker queue

- **Status:** **FIXED** (2026-08-28) for cache and per-provider circuit breaker. Worker queue remains out of scope.
- **File:** `packages/adapters/src/resilience/quote-cache.ts`; `packages/adapters/src/resilience/circuit-breaker.ts`; `packages/adapters/src/resilience/with-quote-resilience.ts`; `apps/api/src/container.ts`; `GET /api/v1/meta` `quoteCircuits`
- **Component:** adapters
- **Problem:** Resilience helper exists; dataset providers do not HTTP. No cache/breaker.
- **Why it matters:** Live adapters will stampede and retry storms.
- **Before:** Every `getQuote` hit the adapter. A failing provider was retried by each request until MultiRailRouter's per-call timeout.
- **After:** Identical quote requests to the same provider/corridor are served from a cache whose TTL is the PA-H09 rail freshness window (never longer). A per-provider circuit breaker opens after three consecutive `getQuote` failures, excludes that adapter from `FinancialProviderRegistry.eligible` (and therefore from MultiRailRouter ranking input) for a 30s cooldown, then half-opens for one probe. Open breakers are logged and published on `GET /meta` `quoteCircuits`. MultiRailRouter remains the only ranking engine. No worker queue.
- **Tests:** `packages/adapters/src/resilience/quote-resilience.test.ts`; `apps/api/src/routes/system.test.ts`
- **Priority:** P1 with live adapters; P3 until then

#### PA-L05 — Agent-to-agent, receive-payments, treasury rail, KYC/sanctions

- **Status:** **DEFERRED** (feature-scale — must not be built as in-platform balances)
- **File:** `docs/MASTER_PRODUCT_DEFINITION.md`; `docs/COMPLIANCE.md` Phase 7 gate; `packages/core/src/engine/routing-types.ts` (`sanctionsScreeningRequired` metadata)
- **Component:** product gaps
- **Problem:** Flags and docs, not programs. `treasury_product` unused.
- **Why it matters:** Stated long-term product. **Must not** be built as in-platform balances.
- **Recommended fix:** Follow COMPLIANCE.md before any of this. Sanctions/KYC are P2 blockers for execution, not for sandbox quoting.
- **Priority:** P2 (compliance gate), P3 (treasury / A2A)
- **Deferred because:** A2A, treasury, and KYC/sanctions programs are product work and must not be implemented as in-platform balances.

#### PA-L06 — E2E uses memory driver by design

- **Status:** **DEFERRED** (feature-scale — new postgres e2e pipeline)
- **File:** `playwright.config.ts`
- **Component:** Phase 19
- **Problem:** Does not exercise Postgres CHECKs over the wire.
- **Why it matters:** Complementary to unit postgres tests, not a replacement.
- **Recommended fix:** Optional e2e job with `DATABASE_DRIVER=postgres`.
- **Priority:** P3
- **Deferred because:** A second e2e job is a CI architecture change; CHECKs are already covered by gated postgres integration tests.

---

## A. Critical issues

| ID | Summary | Status |
| -- | ------- | ------ |
| PA-C01 | `PLATFORM_MODE=production` cannot start: no licensed partner adapters. | **FIXED** — read-only start; routing/execution independently unavailable; no fake licensed adapters |
| PA-C02 | Demo password and `mag_` secret can be provisioned when `NODE_ENV=production`. | **FIXED** — production-locked processes reject demo credentials and require `AUTH_SECRET` |
| PA-C03 | Default `DATABASE_DRIVER=memory` is not forbidden in production. | **FIXED** — production-locked + memory fails closed; postgres required |

No critical issue is “the app secretly moves money.” Custody and live execution were **not** found. Operator contract: `docs/PRODUCTION_GATES.md`.

---

## B. High-priority issues

| ID | Summary | Status |
| -- | ------- | ------ |
| PA-H01 | Viewer/member can PATCH agent policy. | **FIXED** — `agent_policy:write` capability; owner/admin only; audit snapshots |
| PA-H02 | Session scopes include `payment:*` and `transaction:create`. | **FIXED** — role-derived session scopes; no payment or execution-intent rights on sessions |
| PA-H03 | Execution intents bypass policy. | **FIXED** — `gateExecutionIntent` required; missing payment intent fail-closed |
| PA-H04 | Daily limit ignores in-flight intents. | **FIXED** — atomic reserve at `ROUTED`; exclusive agent lock; concurrency test |
| PA-H05 | FX / stablecoin / DeFi are not equal on `/comparisons`; dual engines. | **FIXED** — `/comparisons` ranks via MultiRailRouter 1.0.0; `RouteComparisonService` is not on the HTTP path |
| PA-H06 | Route graph always demo. | **FIXED** — demo graph only when demo adapters are on; otherwise empty or licensed metadata only |
| PA-H07 | Dashboard/chart `Number()` on financial metrics. | **FIXED** — Decimal/`bigint` aggregates; display-only CSS conversion at the chart boundary |
| PA-H08 | Monetization/TPV not recorded on multi-rail HTTP. | **FIXED** — `/routes` returns quoted monetization; `ROUTE_QUOTE` ≠ realized revenue; execution stays 501 |
| PA-H09 | Multi-rail missing quote freshness. | **FIXED** — rail-configured freshness; expired quotes excluded; age in DTO; stale selection requires re-quote |
| PA-H10 | Platform fees skip non-fiat multi-rail corridors. | **FIXED** — canonical take-rate once per route on fiat/stablecoin/DeFi; explicit surcharge; Decimal reconciliation |
| PA-H11 | No CI / container / deploy config. | **FIXED** — GitHub Actions `npm ci` + lint/typecheck/test/e2e/audit/docker build; fail-closed production image |
| PA-H12 | Prisma `deepmerge-ts` high advisory. | **FIXED** — `deepmerge-ts@8.0.2` override; `npm audit --audit-level=moderate` clean; CI audit step |
| PA-H13 | `COMPLETED`/`AUTHORIZED` naming resembles settlement. | **FIXED** — `POLICY_APPROVED` / `SIMULATION_PENDING` / `SIMULATION_COMPLETED`; API.md catalog; no aliases |

---

## C. Medium / low issues

**Closed in this cleanup (PHASE 28):** PA-M08 (daily-spend indexes; CI already ran postgres tests), PA-M14 (external-account wording; optional mint deferred), PA-M16 (strict scope issuance), PA-L01 (display Decimal formatters), PA-L02 (`ExecutionIntentStatus` enum).

**Medium closed (prior):** PA-M01 (credential hashing), PA-M02 (shared rate limits on postgres), PA-M03 (error DTO), PA-M04 (audit actor), PA-M05 (OpenAPI + public vs billed quote surfaces), PA-M06 (agent issuance docs), PA-M11 (`preferredRoutePreference` ranking input), PA-M12 (cookie Secure), PA-M13 (dashboard session middleware), PA-M15 (failed-auth audit).

**Medium still open (deferred, feature-scale):** PA-M07 (cursor pagination), PA-M09 remainder (payment collection, tax, partner AP), PA-M10 (multi-rail fingerprint/replay; would bump engine version if public).

**Low closed:** PA-L01, PA-L02, PA-L03 (TOTP MFA + OIDC; SCIM still out of scope), PA-L04 (quote cache and circuit breaker; worker queue not added).

**Low still open (deferred, feature-scale):** PA-L05 (A2A/treasury/KYC-as-product), PA-L06 (postgres e2e job). SCIM (PA-L03 remainder) and worker queue (PA-L04 remainder) remain out of scope.

---

## D. Production blockers

A production-labelled **quoting** deployment (still non-custodial, still no settlement) is blocked until:

1. ~~Licensed read-only adapters exist **or** production is explicitly forbidden in deploy config (PA-C01).~~ **PA-C01 FIXED:** production starts read-only unless `PRODUCTION_ROUTING_AVAILABLE=true` *and* a licensed adapter exists (none do; the flag fails closed). Licensed adapters remain a product requirement before live quotes.
2. ~~Demo tenant provision and seed cannot run in that environment (PA-C02).~~ **PA-C02 FIXED.**
3. ~~Durable postgres is required and migrations applied (PA-C03).~~ **PA-C03 FIXED** at configuration validation; operators must still provision and migrate a real database.
4. ~~Policy PATCH and session scopes are least-privilege (PA-H01, PA-H02, PA-H03, PA-H04).~~ **PA-H01–H04 FIXED.**
5. ~~Automated verify + audit gate exists (PA-H11, PA-H12).~~ **PA-H11–H12 FIXED.**
6. ~~HTTPS session cookies default secure (PA-M12).~~ **PA-M12 FIXED.**

A production-labelled **partner-execution** deployment is **additionally** blocked by `docs/COMPLIANCE.md`: licensed partner of record, legal review, KYB/KYC, sanctions, transaction monitoring, written instruction. Software today correctly returns 501. Do not treat PA-C01 as a reason to weaken that 501.

---

## E. Recommended implementation order

Do not add product features until this sequence is complete. Do not start delegated execution in this sequence.

1. ~~**Sandbox-gate demo identity** (PA-C02) and **refuse memory in production mode** (PA-C03).~~ **Done.** See `docs/PRODUCTION_GATES.md`.
2. ~~**Authorization:** owner/admin policy PATCH; shrink session scopes; policy-gate execution intents; reserve daily spend (PA-H01–H04). Tests for viewer PATCH and multi-intent daily cap.~~ **Done.**
3. ~~**CI:** `verify`, e2e, postgres integration when URL present, `npm audit` (PA-H11, PA-M08, PA-H12).~~ **PA-H11, PA-H12, and PA-M08 (indexes) done.** CI already ran postgres integration tests; daily-spend composite indexes are in schema.
4. ~~**Docs:** simulation vs settlement naming (PA-H13).~~ **PA-H13 done.** ~~Agents issued; public vs authenticated quote surfaces (PA-M06, PA-M05).~~ **PA-M05 and PA-M06 done.**
5. ~~**Quote integrity:** freshness on multi-rail (PA-H09); platform fee on non-fiat corridors (PA-H10). Decimal dashboard aggregates (PA-H07); monetization hooks on `/routes` (PA-H08).~~ **Done.**
6. **Rail honesty:** ~~`/comparisons` dual engine (PA-H05); mode-gate demo graph (PA-H06).~~ **Done.** Remaining: align `defi` registry status on catalog meta if product wants family filters to expand.
7. ~~**Operational:** redis rate limit, peppered API-key hashes, secure cookies (PA-M01, PA-M02, PA-M12).~~ **Done** with PostgreSQL-backed rate-limit counters (no Redis in this stack — that roadmap item overlaps PA-M02), salted scrypt API-key hashes, HMAC session tokens, and production cookie Secure. Error leakage (PA-M03) and audit-actor spoofing (PA-M04) closed in the same phase.
8. **Phase 5 / PHASE 30 only after a named licensed partner of record is confirmed** (see `docs/COMPLIANCE.md`). Do not invent a partner, wrap sandbox pricing, or relabel a demo adapter as `licensed_partner`. Until then staging/production keep an empty licensed registry and 422 on quote/comparison.
9. **PHASE 33 (execution pilot) only after all four gates in `docs/COMPLIANCE.md` are confirmed outside Cursor** (licensed **execution** rights, compliance/regulatory sign-off, bounded org/agent allowlist with size/volume/corridor caps, incident/rollback plan). As of 2026-08-28 none of those are on file. Do not invent an allowlist, corridor, or partner to lift the 501.
10. **Stop.** Partner execution remains 501 until those gates close. PHASE 33 was **not implemented**.

---

## PHASE 32 — Realized-revenue pathway (platform fees)

Invariant ②: Route View ≠ Route Selection ≠ Execution Intent ≠ External Provider Execution ≠ Verified Settlement ≠ Realized Revenue.

This phase is the first place billed platform-fee revenue is recorded. It is **not** customer-transaction settlement.

| Step | Trigger | `revenueRecognition` | `realizedRevenue` | Cash |
| ---- | ------- | -------------------- | ----------------- | ---- |
| Route view | Authenticated `/routes`, comparisons, agent quotes | `unrealized` | `false` | no |
| Recorded route choice | `POST /execution-intents` (`economicStage: execution_intent`) | `unrealized` | `false` | no |
| Subscription snapshot | Seeded/contracted `enterprise_subscription` | `unrealized` | `false` | no |
| Invoice issued | Operator `POST /ops/billing/invoices/run` for a closed UTC month | `invoiced` | `false` | no |
| Payment collected | Deferred — `DeferredPlatformFeeCollector` | would be `collected` | would be `true` iff collected | not implemented |
| Customer settlement | Would require verified external settlement (`economicStage: settled`) | n/a | counted in `realizedRevenueMinorUnits` | not implemented; executions 501 |

Billing never recomputes pricing. Line items name snapshot IDs. Tax is 0. Issuer is `unconfirmed`. Collection is deferred. Audit events `billing.invoice.issued` and `billing.revenue.recognized` record actor, timestamp, invoice id, and snapshot ids.

---

## PHASE 33 — AI agent payment pilot (not run)

The prompt required four confirmations **outside Cursor** before lifting `POST /api/v1/executions` off 501:

1. PHASE 30 licensed provider covers **execution**, not just quoting.
2. Compliance/regulatory sign-off for real execution.
3. Explicitly bounded pilot (org/agent allowlist, size/daily caps, corridor/rail).
4. Incident/rollback plan for real-money failure.

**None were confirmed.** This session did **not** add a pilot allowlist, provider execution calls, settlement states (`SETTLEMENT_PENDING` / `SETTLEMENT_CONFIRMED`), a live-rail reconciliation job, or a realized-revenue-from-settlement path. Do **not** read this audit as “execution is now live for a bounded pilot.” Execution is **not** live. The audited 501 in `apps/api/src/routes/executions.ts` remains the production control. `executeTransactions` and `delegateExecution` stay false. `realizedRevenue` stays false. Customer assets still never touch the platform (invariant ③) because no funds-movement instruction is issued.

---

## Controls to keep

Do not “clean up” these as if they were incomplete features:

- `POST /api/v1/executions` audited 501
- Capability flags in `packages/core/src/domain/capabilities.ts`
- DB CHECKs on `funds_moved`, `custody`, `executable`, `controlled_by_platform`
- `ProviderRegistry` refusal of sandbox adapters in production
- NL `didNotCompute` / `aiUsed: false` / `financialsComputedBy: 'routing_engine'`
- Zod `.strict()` rejection of `execute` / `privateKey` / `wallet`
- Cross-tenant 404
- Comparison fingerprints and replay
- Simulator `fundsMoved: false` with explicit receipt text

---

*End of original audit. PA-C01, PA-C02, PA-C03, PA-H01–PA-H13, PA-M01–PA-M06, PA-M08, PA-M11–PA-M16, PA-L01–PA-L04 (SCIM out of scope; worker queue out of scope) were fixed in later changes. PHASE 32 implemented invoice generation (PA-M09 invoices). PHASE 33 was refused pending the four business/legal gates. All CRITICAL and HIGH issues are closed. Remaining Medium/Low items are explicitly deferred as feature-scale: PA-M07, PA-M09 collection/tax/partner AP, PA-M10, PA-L05, PA-L06, plus SCIM and worker queue.*
