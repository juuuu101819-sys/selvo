# Meridian — Production Audit

**Product:** Global non-custodial financial routing hub  
**Scope:** Existing repository only (Phases 0–19 as implemented)  
**Date:** 28 August 2026  
**Method:** Source review of `apps/`, `packages/`, `prisma/`, `tests/`, `docs/`, lockfile, and `npm audit --omit=dev`  
**Constraint:** PA-C01, PA-C02, PA-C03, and PA-H01–PA-H08 were subsequently fixed in production code. PA-H09–PA-H13 remain unimplemented. Live execution remains unimplemented (501).

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
  issues PA-H05–PA-H08 are fixed. Remaining HIGH items PA-H09–PA-H13 are untouched.

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

`payment-instruction.ts` is a regex/merchant resolver, not a pricing engine. No balance lookup. Settlement status on NL results is typed `executable: false`, `submitted: false`, `fundsMoved: false`. `COMPLETED` on the payment-intent path is **simulation only** (`sandbox-simulator.ts`).

### Decimal-safe financial calculations — PASS on the money path; display-only conversion at chart CSS

Core money: `bigint` minor units + `decimal.js` clone `Dec` with 34 digits (`packages/core/src/money/decimal.ts`, `money.ts`). Ingress via string major units (`apps/api/src/http/validation.ts`). Persistence uses `toFixed(0)`, never `toNumber()` (`packages/persistence/src/postgres/prisma-driver.ts` line 303). Monetization uses `bigint` (`packages/core/src/engine/monetization-engine.ts`).

**Exceptions (not quote engines):** web display helpers in `apps/web/src/lib/format.ts` still use `Number()` for human-readable percents, bps, and scores (PA-L01). Dashboard metric aggregation and chart geometry no longer do (PA-H07).

### Demo providers cannot execute real transactions — PASS

Sandbox adapters: `licensing: 'unlicensed_sandbox'`, `modes: ['sandbox']`. Production registry refuses them (`packages/core/src/engine/provider-registry.ts` lines 60–89). Simulator never networks. `executable` / `submitted` CHECKs on `execution_intents`.

---

## Review of the 34 areas

| # | Area | Assessment |
| - | ---- | ---------- |
| 1 | Overall architecture | Acyclic monorepo (`web → api → adapters/persistence → core`). `/comparisons` and `/routes` share MultiRailRouter; graph not composed into prices. |
| 2 | Frontend | Next.js 16, server actions, no Execute control. Duplicate wire types. Display `Number()` remains in `format.ts` (PA-L01); dashboard/chart geometry is bigint-scaled (PA-H07). |
| 3 | Backend | Fastify 5, Zod, capability flags. Anonymous public quote surfaces vs authenticated `/quote`. |
| 4 | Database | PostgreSQL schema exists; **default driver is memory**. |
| 5 | Prisma schema | Strong non-custody conventions; CHECKs live in SQL migrations. No billing tables. |
| 6 | API design | `/api/v1` + deprecated `/v1`. Overlapping compare/route/quote/stablecoin/defi APIs. No OpenAPI. |
| 7 | Authentication | Session `mds_`, org key `mk_`, agent `mag_`. Invalid credentials 401. Passwords scrypt. |
| 8 | Authorization | Roles exist but policy PATCH ignores them. Sessions get every API scope. |
| 9 | Organization isolation | Queries keyed by principal `organizationId`. Cross-tenant 404 (tested). |
| 10 | API key security | SHA-256 hash at rest, prefix lookup, scope CHECK. Unsalted. |
| 11 | Financial calculations | Engines Decimal-safe. Dashboard averages use `Dec`/`bigint` (PA-H07). Display `Number()` remains in `format.ts` (PA-L01). |
| 12 | Decimal precision | `DECIMAL(38,0)` amounts, `DECIMAL(38,18)` rates. |
| 13 | Quote engine | `/comparisons` ranks via MultiRailRouter 1.0.0. Fiat `ENGINE_VERSION` 2.0.0 remains on `/meta` and in `RouteComparisonService` (not HTTP). Fingerprints + replay. |
| 14 | Multi-rail routing | 1.0.0 ranks tradfi+stablecoin+DeFi. No freshness assert (PA-H09). `/comparisons` now shares this engine. |
| 15 | Route graph | Demo topology only when `includeDemoAdapters` is true. Production / no licensed metadata → empty graph (PA-H06). Never executable. |
| 16 | Stablecoin abstraction | Helios ramp + Solstice rail. No RPC. USDT→KRW graph-only. |
| 17 | DeFi abstraction | Read-only DEX/AMM/aggregator. Ranked on `/comparisons` via MultiRailRouter when the corridor is quoted. `defiExecution: false`. |
| 18 | AI agent infrastructure | Issue/revoke, intents, NL, dashboard. Simulator, not partner. |
| 19 | Policy engine | Fail-closed for agents. Daily spend under-counts in-flight. Execution intents ungated. |
| 20 | Fee engine | Provider vs platform split; CustomerPricing fiat-only on multi-rail. |
| 21 | Revenue analytics | Quoted ledger + org dashboard. `/routes` and `/comparisons` write `ROUTE_QUOTE` events. Realized revenue stays zero until settlement (unimplemented). |
| 22 | TPV analytics | `tpvMinorUnits` on monetization events; agent dashboard volume. |
| 23 | Referral system | 25% of platform revenue in `priceMonetization`. No partner payout rail (correct). |
| 24 | Audit logging | Append-only; closed event set. Failed logins not recorded. |
| 25 | Rate limiting | In-process Map. Disabled in `NODE_ENV=test` unless overridden. |
| 26 | Error handling | Typed `AppError`; 5xx opaque. Fastify 4xx may echo parser message. |
| 27 | Secrets management | Env Zod; `SecretResolver` for `PROVIDER_*`. Demo secrets in source. |
| 28 | Demo/production separation | Production boot fail-closed for comparison registry. Demo seed sandbox-gated (PA-C02). Graph is demo-gated; production graph is empty until licensed metadata exists (PA-H06). |
| 29 | Testing coverage | 845 unit/integration; 46 e2e (Phase 19). Gaps: production boot, postgres-default CI. Viewer PATCH and daily-spend reservation covered by PA-H01–H04. |
| 30 | Performance | Per-request live quotes, no cache, 4s provider timeout. Fine for sandbox. |
| 31 | Scalability | Memory default; in-process limiter; JSON `quoted_routes` on intents. |
| 32 | Deployment configuration | `.env.example` present. No Dockerfile, no CI workflows, no `vercel.json`. |
| 33 | Dependency vulnerabilities | `npm audit --omit=dev`: 3 **high** via Prisma → `deepmerge-ts` GHSA-ggr8-5vv4-36mx. 0 critical. |
| 34 | Regulatory-risk boundaries | 501 + flags + CHECKs are the software boundary. `COMPLETED` / `AUTHORIZED` naming can look like settlement. KYC/sanctions not implemented (correct until Phase 7). |

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
- **Fix:** Quote expiry is still checked first. A `paymentIntentId` is then required; omitting it is `403 POLICY_DENIED` (`policy_required`). `gateExecutionIntent` re-evaluates policy fail-closed (missing policy, evaluation errors, and non-gated statuses all reject). Allowed statuses are `ROUTED`, `AUTHORIZED`, `EXECUTION_PENDING`, and `COMPLETED`. Select, authorize, simulate, NL routing, and the HTTP execution-intent route all funnel through that gate or `assertPolicy`.
- **Tests:** `apps/api/src/routes/execution-intents.test.ts`; `apps/api/src/routes/policy-hardening.test.ts` (API, service, NL, missing policy)
- **Priority:** P0

#### PA-H04 — Daily spending limit ignores in-flight intents

- **Status:** **FIXED** (2026-08-28)
- **File:** `packages/core/src/domain/agent-payments.ts`; `packages/core/src/engine/agent-payment-service.ts`; persistence agent-payment stores
- **Component:** `DAILY_SPENDING_STATUSES` / `withExclusiveAgentAccess`
- **Problem:** Only `AUTHORIZED`, `EXECUTION_PENDING`, and `COMPLETED` counted. Concurrent `QUOTED` intents could each pass the daily check and then select in parallel.
- **Fix:** `ROUTED` is reserved spend. Select, authorize, simulate, and the execution-intent gate run inside `withExclusiveAgentAccess` (in-process mutex in memory; `SELECT … FOR UPDATE` on the agent policy row in Postgres). Check-and-reserve is a single locked operation; `excludeIntentId` prevents double-counting a row already reserved. `FAILED`/`EXPIRED` are omitted from the status set, so those transitions release the reservation. `COMPLETED` keeps the amount as permanent spend.
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
- **Fix:** `/routes` reuses the same Decimal monetization calculation as the comparison/quote flow (`priceRouteMonetization` / `monetizationFromMultiRailRoute`) and returns that metadata on the DTO (`provider cost`, platform fee, partner commission, gross margin, take rate, TPV). Authenticated discovery writes an auditable `ROUTE_QUOTE` (`economicStage: 'route_quote'`, `realizedRevenue: false`, `fundsMoved: false`). There is no route-selection HTTP surface, so no `route_selected` snapshot is created. An execution intent writes `economicStage: 'execution_intent'` with the same unrealized flags; fees are not invented when no live priced route is supplied. Nothing in this tree writes `economicStage: 'settled'` or sets `realizedRevenue: true`. `POST /api/v1/executions` remains 501. Aggregation counts realized revenue only for `settled` events, so realized totals stay `0`.
- **Tests:** `apps/api/src/routes/routing-monetization.test.ts` (A–G); `packages/core/src/engine/monetization-engine.test.ts` — settled vs quote/intent; large-TPV Decimal identity.
- **Priority:** P1

#### PA-H09 — Multi-rail quoting does not apply comparison-grade freshness

- **File:** `packages/core/src/engine/routing-engine.ts` (`requestQuote`, lines 326–369); freshness lives in `packages/core/src/quotes/quote-freshness.ts` and `comparison-service.ts`
- **Component:** `MultiRailRouter.requestQuote`
- **Problem:** Fiat comparisons call `assertQuoteUsable`. Multi-rail and agent quotes do not. Agent flow only checks `quoteExpiresAt` later.
- **Why it matters:** Stale catalog quotes can be ranked and selected.
- **Recommended fix:** Reuse `DEFAULT_FRESHNESS_POLICY` on catalog `getQuote` results.
- **Priority:** P1

#### PA-H10 — Customer platform pricing is skipped on non-fiat multi-rail corridors

- **File:** `packages/core/src/engine/routing-engine.ts` (platform charge / `NO_ROUTING_PLATFORM_CHARGE`, ~263–318)
- **Component:** `MultiRailRouter.loadPricingRules`
- **Problem:** `CustomerPricing` applies on fiat↔fiat. Stablecoin and DeFi legs get no platform fee.
- **Why it matters:** Fee engine and take-rate are incomplete for two of three rails.
- **Recommended fix:** Define asset-aware platform charges without inventing unagreed markups (memory driver currently charges zero by design — `container.ts` lines 118–124).
- **Priority:** P1

#### PA-H11 — No CI, container, or deploy manifest

- **File:** repository root (no `.github/workflows`, no `Dockerfile`, no `vercel.json`, no `environment.json`)
- **Component:** deployment
- **Problem:** `npm run verify` and Playwright exist locally only. `next.config.ts` has no production headers/asset policy beyond defaults.
- **Why it matters:** Production cannot be gated on lint/typecheck/test/e2e or `npm audit`.
- **Recommended fix:** CI workflow running `verify`, e2e, optional `TEST_DATABASE_URL`, and `npm audit`. Container or platform config for API + web.
- **Priority:** P0 for process; P1 for images

#### PA-H12 — Prisma `deepmerge-ts` high advisory (GHSA-ggr8-5vv4-36mx)

- **File:** lockfile / `prisma@7.10.0` → `@prisma/config` → `deepmerge-ts < 8`
- **Component:** CLI/config merge (dev/build path)
- **Problem:** `npm audit --omit=dev` reports 3 high (same advisory, no CVSS). Force-fix would downgrade Prisma 7 → 6.
- **Why it matters:** Stack exhaustion on recursive merge in Prisma config tooling, not the quote engine. Still a production-dependency finding.
- **Recommended fix:** Wait for Prisma to bump `deepmerge-ts`, or isolate CLI. Do not `--force` to Prisma 6 without a dedicated phase.
- **Priority:** P1

#### PA-H13 — Payment statuses `AUTHORIZED` / `EXECUTION_PENDING` / `COMPLETED` read as settlement

- **File:** `packages/core/src/domain/agent-payments.ts` (status enum); `packages/core/src/engine/sandbox-simulator.ts` (lines 18–27); `apps/api/src/routes/agent-payments.ts` simulate handler
- **Component:** agent payment lifecycle
- **Problem:** Simulator sets `COMPLETED` with `fundsMoved: false`. API names match licensed payment rails.
- **Why it matters:** Auditors or integrators can treat simulation as execution. Software flags are correct; naming is the risk.
- **Recommended fix:** Before any public production API, rename to simulation statuses **or** require every client-facing payload to lead with `realExecution: false` / `simulated: true` in docs and OpenAPI examples. Do not silently “look executable.”
- **Priority:** P1 (appearance); P2 (before external developers)

---

### MEDIUM

#### PA-M01 — Unsalted SHA-256 for API keys, agent secrets, and session tokens

- **File:** `packages/core/src/crypto/secrets.ts` (lines 80–94)
- **Component:** `hashSecret` / `secretsMatch`
- **Problem:** High-entropy tokens hashed with unsalted SHA-256. Passwords correctly use scrypt (lines 31–38).
- **Why it matters:** DB dump + token reuse is easier to brute than a KDF. Mitigated by 32-byte random secrets.
- **Recommended fix:** HMAC-SHA256 with a server pepper, or scrypt with per-secret salt. Timing-safe compare already present.
- **Priority:** P1

#### PA-M02 — In-process rate limiter

- **File:** `apps/api/src/http/rate-limit.ts` (lines 16–58)
- **Component:** `registerRateLimiting`
- **Problem:** Per-process `Map` keyed by org or IP. No shared store. Restarts reset buckets.
- **Why it matters:** Multiple replicas multiply quota; anonymous `/comparisons` is IP-only.
- **Recommended fix:** Redis (or equivalent) behind the same hook. Per-route budgets for quote fan-out.
- **Priority:** P1

#### PA-M03 — Fastify 4xx messages forwarded to clients

- **File:** `apps/api/src/http/errors.ts` (lines 52–62)
- **Component:** `setErrorHandler`
- **Problem:** Non-`AppError` 4xx uses `error.message`. 5xx is opaque (good).
- **Why it matters:** Parser wording leakage (payload size, content-type).
- **Recommended fix:** Map to a generic `VALIDATION_ERROR` message.
- **Priority:** P2

#### PA-M04 — Spoofable audit actor on anonymous requests

- **File:** `apps/api/src/auth/identity-authenticator.ts` (lines 160–170)
- **Component:** `anonymousFrom` / `X-Meridian-Actor`
- **Problem:** Unauthenticated callers can set `actor` on audit rows (e.g. execution 501).
- **Why it matters:** Audit integrity, not fund movement.
- **Recommended fix:** Ignore declared actor unless `verified: true`.
- **Priority:** P2

#### PA-M05 — Overlapping public vs authenticated quote APIs; no OpenAPI

- **File:** `apps/api/src/routes/index.ts`; `docs/API.md`; no OpenAPI artefact
- **Component:** `/comparisons`, `/routes`, `/quote`, `/stablecoin-routes`, `/defi-routes`
- **Problem:** `/quote` requires `quote:read`; `/routes` is anonymous and uses the same multi-rail engine. Web restates DTOs in `apps/web/src/lib/api/types.ts`.
- **Why it matters:** Auth bypass by using the public twin; contract drift.
- **Recommended fix:** Authenticate catalog quotes or document public vs billed surfaces. Generate OpenAPI from Zod.
- **Priority:** P1

#### PA-M06 — Docs still say agents are not issued

- **File:** `docs/ARCHITECTURE.md` (lines 43–44, 64–65); `docs/MASTER_PRODUCT_DEFINITION.md` (later “not in this phase” language)
- **Component:** documentation
- **Problem:** `POST /api/v1/agents` issues `mag_` credentials (`apps/api/src/routes/agent-payments.ts`).
- **Why it matters:** Operators following architecture text will mis-assess the attack surface.
- **Recommended fix:** Update §0 to Phases 14–18 reality. Do not change code.
- **Priority:** P1

#### PA-M07 — List pagination is limit-only

- **File:** `apps/api/src/http/validation.ts` (`listQuerySchema`, ~lines 117–118)
- **Component:** dashboard and intent lists
- **Problem:** `limit` 1–100, no cursor. Default dashboard page size 50.
- **Why it matters:** Large tenants cannot page stably.
- **Recommended fix:** Cursor pagination on quotes, intents, comparisons.
- **Priority:** P2

#### PA-M08 — Postgres integration tests are opt-in; daily-spend query under-indexed

- **File:** `packages/persistence/src/postgres/prisma-driver.integration.test.ts`; `prisma/schema.prisma` (`payment_intents` indexes ~475–476); `packages/persistence/src/postgres/prisma-agent-payments.ts` (`sumDailySpending`)
- **Component:** CI / indexes
- **Problem:** Tests skip without `TEST_DATABASE_URL`. Daily sum filters status + asset + timestamps without a matching composite index.
- **Why it matters:** CHECK/migration regressions and slow policy checks under load.
- **Recommended fix:** Run postgres tests in CI. Add an index aligned to `sumDailySpending`.
- **Priority:** P1

#### PA-M09 — No invoices, subscriptions, or partner-payout tables

- **File:** `prisma/schema.prisma` (`MonetizationEvent` lines 480–511)
- **Component:** billing
- **Problem:** Referral/commission is an attributed field, not accounts payable. `enterprise_api_subscription` is a seeded demo event.
- **Why it matters:** Business model (API fees, enterprise fees, partner commissions) is not operable. Correct that it is not a cash ledger.
- **Recommended fix:** Separate billing domain when charging customers; keep `fundsMoved: false` on routing events.
- **Priority:** P2

#### PA-M10 — Multi-rail results have no comparison-style fingerprint/replay

- **File:** `packages/core/src/engine/routing-engine.ts`; fingerprints in `packages/core/src/reproducibility/fingerprint.ts` used by comparison service
- **Component:** reproducibility
- **Problem:** Agent intents hash create-payload for idempotency, not provider quotes. `/routes` has `routingId` only.
- **Why it matters:** Disputes on multi-rail quotes cannot replay like `/comparisons/:id/replay`.
- **Recommended fix:** Snapshot + fingerprint multi-rail evaluations (new engine version if the snapshot shape is public).
- **Priority:** P2

#### PA-M11 — `preferredRoutePreference` is not a policy rule

- **File:** `packages/core/src/domain/payment-policy.ts`; policy fields on `PaymentPolicy`
- **Component:** policy engine
- **Problem:** Stored and shown on the dashboard; `evaluatePaymentPolicy` does not enforce it.
- **Why it matters:** Operators may believe agents are locked to lowest-cost.
- **Recommended fix:** Enforce on quote/select or label the field as a default, not a control.
- **Priority:** P2

#### PA-M12 — Cookie `secure` is off unless `COOKIE_SECURE=true`

- **File:** `apps/web/src/lib/session.ts` (~lines 11–24)
- **Component:** session cookie
- **Problem:** Default `secure: false` for local HTTP. Easy to forget in HTTPS production.
- **Why it matters:** Session cookie theft on mixed-content or HTTPS deploys.
- **Recommended fix:** Default `secure` true when `NODE_ENV=production`.
- **Priority:** P1

#### PA-M13 — Next middleware only checks cookie presence

- **File:** `apps/web/src/middleware.ts` (lines 8–17)
- **Component:** `/dashboard` gate
- **Problem:** Any non-empty `meridian_session` cookie reaches the dashboard; API then rejects.
- **Why it matters:** Extra round-trip, not a data leak if server actions always hit the API (they do).
- **Recommended fix:** Optional `/auth/me` check; not a substitute for API auth.
- **Priority:** P3

#### PA-M14 — Auto-created “wallet” reference on agent issue

- **File:** `apps/api/src/routes/agent-payments.ts` (lines 123–131)
- **Component:** `POST /agents`
- **Problem:** Synthetic `external_account` / `ext_acct_*` handle. `controlledByPlatform` remains false.
- **Why it matters:** Wording can look like wallet provisioning.
- **Recommended fix:** Rename to external account reference; make optional.
- **Priority:** P2

#### PA-M15 — Failed authentication is not an audit event

- **File:** `apps/api/src/routes/auth.ts`; `packages/core/src/ports/audit.ts` event set
- **Component:** login
- **Problem:** Brute force is not in the financial audit log (rate limit may still apply).
- **Why it matters:** Security monitoring gap.
- **Recommended fix:** Append `auth.login.failed` with hashed identifier, no password.
- **Priority:** P2

#### PA-M16 — `parseApiScopes` silently drops unknown strings

- **File:** `packages/core/src/domain/api-scope.ts` (lines 47–57)
- **Component:** key issuance
- **Problem:** Invalid scope names are skipped rather than 400.
- **Why it matters:** Operator may think a key has a right it does not.
- **Recommended fix:** Reject unknown scopes at Zod parse (already constrained for org keys; keep consistent).
- **Priority:** P3

---

### LOW

#### PA-L01 — Display-only `Number()` in the web app

- **File:** `apps/web/src/lib/format.ts` (lines 68–109); `apps/web/src/components/cost-comparison.tsx`; `route-card.tsx`
- **Component:** UI formatting
- **Problem:** Percent, bps, and score strings converted with `Number()` for presentation. Amounts correctly use integer minor units in `format.ts`.
- **Why it matters:** Typical USD bps are safe; not a quote-engine bug.
- **Recommended fix:** Format bps via `Dec` if operators will show sub-0.01 bps.
- **Priority:** P3

#### PA-L02 — `ExecutionIntent.status` is a free `String` in Prisma

- **File:** `prisma/schema.prisma` (line 326)
- **Component:** `ExecutionIntent`
- **Problem:** Domain + SQL CHECK force `recorded`; Prisma layer is weaker.
- **Why it matters:** Accidental new statuses in application code before a migration.
- **Recommended fix:** Enum in schema when convenient.
- **Priority:** P3

#### PA-L03 — No SSO, MFA, SCIM

- **File:** `docs/ARCHITECTURE.md` §10
- **Component:** identity
- **Problem:** Email/password + API keys only. Documented out of scope.
- **Why it matters:** Enterprise buyers.
- **Recommended fix:** Later identity phase. Not a sandbox defect.
- **Priority:** P3

#### PA-L04 — No quote cache, circuit breaker, or worker queue

- **File:** `docs/ROADMAP.md` Phase 5; `packages/adapters/src/resilience/execute.ts`
- **Component:** adapters
- **Problem:** Resilience helper exists; dataset providers do not HTTP. No cache/breaker.
- **Why it matters:** Live adapters will stampede and retry storms.
- **Recommended fix:** Phase 5 with licensed HTTP adapters.
- **Priority:** P1 with live adapters; P3 until then

#### PA-L05 — Agent-to-agent, receive-payments, treasury rail, KYC/sanctions

- **File:** `docs/MASTER_PRODUCT_DEFINITION.md`; `docs/COMPLIANCE.md` Phase 7 gate; `packages/core/src/engine/routing-types.ts` (`sanctionsScreeningRequired` metadata)
- **Component:** product gaps
- **Problem:** Flags and docs, not programs. `treasury_product` unused.
- **Why it matters:** Stated long-term product. **Must not** be built as in-platform balances.
- **Recommended fix:** Follow COMPLIANCE.md before any of this. Sanctions/KYC are P2 blockers for execution, not for sandbox quoting.
- **Priority:** P2 (compliance gate), P3 (treasury / A2A)

#### PA-L06 — E2E uses memory driver by design

- **File:** `playwright.config.ts`
- **Component:** Phase 19
- **Problem:** Does not exercise Postgres CHECKs over the wire.
- **Why it matters:** Complementary to unit postgres tests, not a replacement.
- **Recommended fix:** Optional e2e job with `DATABASE_DRIVER=postgres`.
- **Priority:** P3

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
| PA-H09 | Multi-rail missing quote freshness. | Open |
| PA-H10 | Platform fees skip non-fiat multi-rail corridors. | Open |
| PA-H11 | No CI / container / deploy config. | Open |
| PA-H12 | Prisma `deepmerge-ts` high advisory. | Open |
| PA-H13 | `COMPLETED`/`AUTHORIZED` naming resembles settlement. | Open |

---

## C. Medium / low issues

**Medium:** PA-M01–PA-M16 (secret hashing, rate limit, error leakage, anonymous actor, API overlap, docs drift, pagination, postgres CI/indexes, billing tables, multi-rail fingerprints, unenforced preference, cookie secure flag, middleware, wallet wording, login audit, silent scopes).

**Low:** PA-L01–PA-L06 (display `Number()`, Prisma string status, SSO/MFA, cache/breakers, A2A/treasury/KYC-as-product, e2e memory).

---

## D. Production blockers

A production-labelled **quoting** deployment (still non-custodial, still no settlement) is blocked until:

1. ~~Licensed read-only adapters exist **or** production is explicitly forbidden in deploy config (PA-C01).~~ **PA-C01 FIXED:** production starts read-only unless `PRODUCTION_ROUTING_AVAILABLE=true` *and* a licensed adapter exists (none do; the flag fails closed). Licensed adapters remain a product requirement before live quotes.
2. ~~Demo tenant provision and seed cannot run in that environment (PA-C02).~~ **PA-C02 FIXED.**
3. ~~Durable postgres is required and migrations applied (PA-C03).~~ **PA-C03 FIXED** at configuration validation; operators must still provision and migrate a real database.
4. ~~Policy PATCH and session scopes are least-privilege (PA-H01, PA-H02, PA-H03, PA-H04).~~ **PA-H01–H04 FIXED.**
5. Automated verify + audit gate exists (PA-H11, PA-H12).
6. HTTPS session cookies default secure (PA-M12).

A production-labelled **partner-execution** deployment is **additionally** blocked by `docs/COMPLIANCE.md`: licensed partner of record, legal review, KYB/KYC, sanctions, transaction monitoring, written instruction. Software today correctly returns 501. Do not treat PA-C01 as a reason to weaken that 501.

---

## E. Recommended implementation order

Do not add product features until this sequence is complete. Do not start delegated execution in this sequence.

1. ~~**Sandbox-gate demo identity** (PA-C02) and **refuse memory in production mode** (PA-C03).~~ **Done.** See `docs/PRODUCTION_GATES.md`.
2. ~~**Authorization:** owner/admin policy PATCH; shrink session scopes; policy-gate execution intents; reserve daily spend (PA-H01–H04). Tests for viewer PATCH and multi-intent daily cap.~~ **Done.**
3. **CI:** `verify`, e2e, postgres integration when URL present, `npm audit` (PA-H11, PA-M08, PA-H12).
4. **Docs:** agents issued; public vs authenticated quote surfaces; simulation vs settlement naming (PA-M06, PA-H13).
5. **Quote integrity:** freshness on multi-rail (PA-H09). ~~Decimal dashboard aggregates (PA-H07); monetization hooks on `/routes` (PA-H08).~~ **Done.**
6. **Rail honesty:** ~~`/comparisons` dual engine (PA-H05); mode-gate demo graph (PA-H06).~~ **Done.** Remaining: align `defi` registry status on catalog meta if product wants family filters to expand.
7. **Operational:** redis rate limit, peppered API-key hashes, secure cookies (PA-M01, PA-M02, PA-M12).
8. **Phase 5 only after 1–7:** licensed read-only FX, payment, ramp, DEX APIs; persist `Quote` rows; then consider production mode.
9. **Stop.** Partner execution remains 501 until the compliance gate.

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

*End of original audit. PA-C01, PA-C02, PA-C03, and PA-H01–PA-H08 were fixed in later changes; PA-H09–PA-H13 and below were not implemented in those changes.*
