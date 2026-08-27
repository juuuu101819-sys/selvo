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

## Phase 11 — Stablecoin routing layer ✅ implemented

A dedicated quoting surface for fiat ↔ stablecoin and stablecoin ↔ stablecoin, on top of the
existing financial catalog. Demo assets: **USDC**, **USDT**. Adding a later stablecoin is a
registry row plus adapter rates — `StablecoinRouter` never switches on ticker.

- Conversion kinds: `fiat_stablecoin`, `stablecoin_fiat`, `stablecoin_stablecoin`
- Quote fields: `asset`, `chain`, `price`, `providerFee`, `networkFee`, `slippage`, `liquidity`,
  `estimatedSettlementTime`, `expiration`
- Chain metadata (`CHAIN_REGISTRY`, CAIP-2). Ethereum is listed for quotes; `connected` is always
  `false` and `rpcUrl` is always `null`. Base and Sepolia are reserved as planned.
- Helios Ramp rate tables cover USDC and USDT vs USD/EUR/GBP; USDC → KRW remains the only KRW
  off-ramp. USDT → KRW is still unsupported.
- `GET /api/v1/stablecoins` and `POST /api/v1/stablecoin-routes`
- `stablecoinRoutingEngineVersion` **1.0.0**, independent of comparison `2.0.0`, routing `1.0.0`
  and graph `1.0.0`
- Platform does not custody stablecoins. No mainnet connection, wallets, or private keys.
- Comparison engine unchanged (four USD→KRW routes). Multi-rail scoring unchanged.

**Still excluded:** on-chain execution, custody, keys, wallets, live partner credentials,
AI-determined prices.

## Phase 12 — DeFi liquidity routing layer ✅ implemented

A non-custodial DeFi liquidity abstraction on top of the financial catalog. Demo venues: **DEX**,
**AMM**, **DEX aggregator**. Demo pools: **USDC/USDT**, **ETH/USDC**, **ETH/USDT**. Each venue
implements a normalised `DeFiLiquiditySource`: `getQuote`, `getLiquidity`, `getSwapFee`,
`getEstimatedSlippage`, `getNetworkFee`, `getSupportedTokens`, `getSupportedChains`.

- The router ranks DEX / AMM / aggregator quotes, and a **stablecoin** or **traditional FX** quote
  on the same pair when a catalog provider can price it
- Output is a quote plus `recommendedExecutionRoute` — never a submitted swap
- Chain metadata (`CHAIN_REGISTRY`, CAIP-2) lists Ethereum (quoting available), Base, Arbitrum,
  Sepolia and Solana (planned). `connected` is always `false` and `rpcUrl` is always `null`. Adding
  a chain is a registry row; the engine does not switch on chain name
- `GET /api/v1/defi-liquidity` and `POST /api/v1/defi-routes`
- `defiRoutingEngineVersion` **1.0.0**, independent of comparison `2.0.0`, routing `1.0.0`,
  graph `1.0.0` and stablecoin `1.0.0`
- Platform does not custody pool inventory. No mainnet connection, wallets, or private keys
- Comparison engine unchanged (four USD→KRW routes). Multi-rail scoring unchanged.
  `RAIL_FAMILY_REGISTRY.defi` and `dex_liquidity` remain `planned` for `POST /comparisons`

**Still excluded:** on-chain execution, custody, keys, wallets, live partner credentials,
AI-determined prices.

## Phase 13 — Financial routing API ✅ implemented

Versioned organization API for quote, path search and catalogs, with hashed API keys.

- `POST /api/v1/quote` — authenticated multi-rail quote (`quote:read`). Slim DTO:
  `requestId`, `routes`, `recommendedRoute`, `quoteExpiresAt`. Optional body `organizationId` is a
  claim that must match the principal
- `POST /api/v1/routes/search` — graph discovery plus catalog providers for a pair (`route:read`).
  Not a second live quote engine. `POST /api/v1/routes` stays public
- `GET /api/v1/providers` unchanged (8 catalog providers). `GET /api/v1/assets`,
  `GET /api/v1/currencies` public catalogs
- Organization API keys: SHA-256 hashed secrets, never plaintext; revocation; expiry; scopes
  `quote:read`, `route:read`, `transaction:create`. Default issued scopes omit `transaction:create`
- `transaction:create` writes an execution intent (`status: recorded`, `executable: false`,
  `submitted: false`). `POST /api/v1/executions` remains the audited 501
- In-process rate limiting. Request logs redact credentials and never print API key secrets
- `financialRoutingApi` and `executionIntents` true. `executeTransactions` stays false.
  Comparison engine **2.0.0**, routing **1.0.0**, graph **1.0.0**, stablecoin **1.0.0**,
  DeFi **1.0.0** unchanged

**Still excluded (at Phase 13):** real transactions, wallets, keys, custody, DeFi execution, AI agent payments.

## Phase 14 — AI agent payment infrastructure ✅ implemented

Autonomous AI agents act *for* an organization. They never custody funds on this platform.

```
AI Agent → Financial Router → Financial Rail → External Provider
```

- Domain: `Agent`, `AgentWalletReference` (external handle, `controlledByPlatform: false`), `Merchant`, `PaymentPolicy`, `PaymentIntent`
- Intent fields: `agentId`, `sourceAsset`, `destinationAsset`, `amount`, `recipient`, `purpose`, `routePreference`, `maxFee`, `expiresAt`, `status`
- Statuses: `CREATED` → `QUOTING` → `QUOTED` → `ROUTED` → `AUTHORIZED` → `EXECUTION_PENDING` → `COMPLETED`, plus `FAILED` and `EXPIRED`
- Sandbox instruction `"Pay 500 USD to merchant X"` parses into a structured intent
- Flow: create intent → quote (existing `MultiRailRouter`) → select route → authorize → simulate via in-process demo provider
- Hashed agent credentials (`mag_`), scopes `payment:create` / `payment:quote` / `payment:authorize` plus `quote:read`
- Idempotency keys on create. Policy engine: max amount, allowed assets, recipients, providers, max fee, daily spending
- `COMPLETED` means the simulator finished. `fundsMoved`, `custody` and `realExecution` stay false. `POST /executions` remains 501
- `agentPayments` and `agentPaymentSimulation` true. `executeTransactions`, `delegateExecution`, `custodyFunds`, `holdPrivateKeys`, `controlCustomerWallets`, `operateAsPrincipal`, `defiExecution` stay false
- Interaction model `agent_business` available. Engine versions unchanged

Treasury product comparison remains planned on the `treasury_product` rail.

## Phase 15 — AI agent natural-language routing interface ✅ implemented

AI agents (and LLM tools acting for them) send language. A deterministic parser interprets intent.
The routing engine computes the financial result. The parser never calculates exchange rates, fees,
slippage or settlement amounts.

```
Natural Language
  → Intent Parser
  → Structured Payment Intent
  → Policy Engine
  → Routing Engine
  → Provider Quote
  → Route Selection
  → Execution Intent
```

Example: `"Pay 1,000 USD to this merchant using the cheapest compliant route."` becomes

```json
{
  "amount": { "asset": "USD", "minorUnits": "100000", "decimal": "1000.00", "exponent": 2 },
  "sourceAsset": "USD",
  "destinationAsset": "KRW",
  "recipient": "merchant-x",
  "optimizationPreference": "LOWEST_COST"
}
```

- Preferences: `LOWEST_COST`, `FASTEST`, `BALANCED`, `LOWEST_SLIPPAGE`, `HIGH_LIQUIDITY`
- `POST /api/v1/agent/interpret` — parse only (`aiUsed: false`, `financialsComputedBy: null`)
- `POST /api/v1/agent/route` — full pipeline through a recorded execution intent (`executable: false`)
- Quotes still come from `MultiRailRouter` (version **1.0.0**). Comparison **2.0.0**, graph **1.0.0**,
  stablecoin **1.0.0**, DeFi **1.0.0** unchanged
- `agentNaturalLanguageRouting` true. `executeTransactions` stays false. `POST /executions` remains 501

## Phase 16 — Non-custodial payment policy engine ✅ implemented

The policy engine decides what an AI agent is allowed to request. It runs **before** route execution
intent creation. A violation **fails closed**. Every decision (allow and deny) is audit-logged.

```
AI Agent → Payment Intent → Policy Engine → Route Engine → Quote → Authorization → Execution Intent
```

Rules: maximum transaction amount, daily transaction limit, allowed assets, allowed chains,
allowed providers, allowed countries, allowed recipients, maximum fees, minimum route score,
minimum liquidity, maximum slippage.

Demo Agent A:

- max transaction $1,000 (`100000` USD minor units)
- daily limit $10,000 (`1000000`)
- assets USD, USDC, KRW (KRW is required because Merchant X settles KRW)
- providers `sandbox-veridian-payments`, `sandbox-solstice-settlement`
- max slippage 0.5% (`50` bps)
- empty allow-lists mean **none**, not all

Missing policy, missing route score/slippage, or zero surviving quoted routes are `403 POLICY_DENIED`.
`paymentPolicyEngine` is true. Engine versions unchanged. `POST /executions` remains 501.

## Phase 17 — Multi-rail monetization engine ✅ implemented

Extends the existing fee split (provider vs platform) with a quoted revenue ledger. Arithmetic is
Decimal/`bigint` only. Nothing here collects funds.

Revenue sources (closed set):

1. Traditional FX routing fee
2. Payment routing fee
3. Stablecoin routing fee
4. DeFi routing fee
5. Liquidity routing fee
6. Partner referral commission
7. Enterprise API subscription
8. AI agent payment fee
9. Enterprise volume pricing

Identity on a $100,000 send:

| Concept | Amount |
|---|---|
| TPV | $100,000 |
| Provider cost | $300 |
| Platform routing fee / gross revenue | $200 |
| Partner commission | $50 (25% of platform revenue) |
| Gross profit / net platform contribution | $150 |
| Take rate | 20 bps |

`grossRevenue = platformRevenue`. Partner commission is a payout from platform revenue, not a second
customer charge. Subscriptions have TPV 0 and a null take rate. Analytics break down by rail,
provider, currency, asset, organization, AI agent, transaction type, revenue source and date.

`GET /api/v1/dashboard/revenue` is organization-scoped. The demo tenant is seeded with every source,
including the $100k example. `multiRailMonetization` is true. Engine versions unchanged.
`POST /executions` remains 501.

