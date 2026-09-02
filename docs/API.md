# Meridian API

Base URL in local development: `http://127.0.0.1:47311`

All versioned routes are served under **`/api/v1`**. The original `/v1` prefix still works and
returns `Deprecation: true` with a `Link` header naming its successor; it will be removed in the
next version.

Every quote this API returns is **indicative and non-binding**. Meridian is a non-custodial routing
hub: it does not custody funds, hold keys, act as principal, or execute transfers; see
[COMPLIANCE.md](./COMPLIANCE.md) and [MASTER_PRODUCT_DEFINITION.md](./MASTER_PRODUCT_DEFINITION.md).

## Conventions

**Envelope.** Successful responses on `/v1` wrap their payload:

```json
{
  "data": { "...": "..." },
  "meta": { "mode": "sandbox", "disclaimer": "...", "requestId": "req_..." }
}
```

**Cursor pagination.** List GETs (`/comparisons`, `/execution-intents`, `/payment-intents`,
`/dashboard/quotes`, `/dashboard/transactions`, `/dashboard/invoices`) take `limit` (1–100; default
20, dashboard lists 50) and an opaque `cursor`. Excess `limit` is `400`, not a clamped unbounded
page. `offset` is rejected. The response `meta` includes `limit` and `nextCursor` (`null` when there
is no further page). The cursor is a keyset on `(sortAt DESC, id DESC)`: a row inserted after page 1
is fetched does not appear as a duplicate or skip inside the already-walked range. A truncated,
tampered, or foreign-org cursor is `400 VALIDATION_ERROR`, not silently ignored.

**Errors.** Every failure has the same shape, with a stable machine-readable `code`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body.",
    "details": { "issues": [{ "path": "amount", "message": "..." }] },
    "requestId": "req_..."
  }
}
```

| Code                                  | Status    | Meaning                                                                                      |
| ------------------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`                    | 400       | Request failed schema or amount validation.                                                  |
| `UNSUPPORTED_CURRENCY`                | 400       | Currency is outside the supported set.                                                       |
| `UNSUPPORTED_CORRIDOR`                | 422       | No registered provider will price this request — the corridor, the amount, or a rail filter. |
| `NO_ROUTES_AVAILABLE`                 | 422       | Providers were eligible but none returned a usable quote.                                    |
| `NOT_FOUND`                           | 404       | Unknown comparison, quote, transaction — or one that belongs to another organization.        |
| `UNAUTHENTICATED`                     | 401       | Missing or unverifiable session / API key.                                                   |
| `FORBIDDEN`                           | 403       | Authenticated, but the credential lacks the required scope or claimed org does not match.    |
| `POLICY_DENIED`                       | 403       | Agent policy or a verified mandate rejected the request. `details.rule` names the rule.      |
| `ONBOARDING_INCOMPLETE`               | 403       | Production-locked licensed quotes: KYB is not verified and/or no explicit CustomerPricing row exists. Sandbox exploration is not gated. |
| `MANDATE_REJECTED`                    | 422       | Signed mandate could not be accepted. `details.reason`: `expired`, `revoked`, `signature_invalid`, `scope_invalid`, `challenge_invalid`. |
| `X402_PAYMENT_REQUIRED`               | 402       | x402 challenge. Retry `POST /mandates/verify` with a signed authorization. Never moves funds. |
| `IDEMPOTENCY_CONFLICT`                | 409       | Idempotency key reused with a different payload.                                             |
| `QUOTE_EXPIRED`                       | 409       | Quoted price is past `expiresAt`. `requoteRequired: true` — request a new quote.             |
| `RATE_LIMITED`                        | 429       | Too many requests in the current window. `Retry-After` is set.                               |
| `EXECUTION_NOT_IMPLEMENTED`           | 501       | Deliberate refusal to move money.                                                            |
| `PROVIDER_TIMEOUT` / `PROVIDER_ERROR` | 504 / 502 | Upstream provider failed. Usually reported per-route in `providerFailures` instead.          |
| `INTERNAL_ERROR`                      | 500       | Unexpected defect. Details are never leaked.                                                 |

**Money.** Amounts always serialise with the integer minor units as the authoritative value:

```json
{ "currency": "KRW", "minorUnits": "138071533", "decimal": "138071533", "exponent": 0 }
```

Parse `minorUnits`, not `decimal`. Rates, basis points and percentages are exact decimal strings
for the same reason — never JSON numbers.

**Headers.**

| Header                        | Direction | Purpose                                                                                    |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `Idempotency-Key`             | request   | 8–128 chars. Replays return the original comparison.                                       |
| `X-Meridian-Actor`            | request   | Unverified attribution for the audit trail, used only while no credential can be verified. |
| `X-Onboarding-Operator-Key`   | request   | Sales-ops secret for invite-only org create, KYB review, and pricing attach. Compared as SHA-256. Missing/wrong → the same 401. Never logged. |
| `Authorization` / `X-Api-Key` | request   | Session bearer (`mds_…`) or organization API key. Unverifiable credentials are `401`.      |
| `X-Request-Id`                | response  | Correlates a response with its log and audit entries.                                      |
| `Deprecation` / `Link`        | response  | Present on the legacy `/v1` prefix only.                                                   |

**Authentication.** Public comparison, meta, health, provider catalog, assets, currencies, and
invite acceptance stay available without a credential. Presenting `Authorization: Bearer mds_…` or `X-Api-Key` authenticates
a user or service principal whose `organizationId` scopes every tenant query. Organization API keys
carry explicitly minted scopes (`quote:read`, `route:read`, `transaction:create`). Session users
receive the scopes of their membership role at login (`viewer`/`member`: `quote:read` and
`route:read` only; `owner`/`admin` additionally receive `agent_policy:write`). Sessions never
receive `payment:*` or `transaction:create`. A credential
that cannot be verified is `401 UNAUTHENTICATED`, never silently treated as anonymous.
`GET /api/v1/meta` reports the active scheme under `authentication` (`session+api_key`,
`enforcing: true`).

Organization API keys are hashed with per-key salted scrypt before persist, never stored in plaintext,
and support revocation, expiry and scopes. Session tokens are HMAC-SHA-256 under a pepper derived from
`AUTH_SECRET`. The raw API-key secret is returned once on `POST /api/v1/api-keys`. Request
logs redact `Authorization`, `X-Api-Key`, passwords, tokens, wallets and private keys. Shared
rate limiting (PostgreSQL `rate_limit_buckets` in production; in-process map with the memory driver)
applies to `/api/v1` (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`). Exceeding the limit is HTTP 429 with
`Retry-After`. Authenticated callers are limited by principal; anonymous callers by IP.

Demo sandbox login: `treasury@demo-trading.example.invalid` / `MeridianDemo!2026`. Sessions last
12 hours. Dashboard settings return API key **prefixes** only. Optional MFA and OIDC:
[AUTH.md](./AUTH.md).

---

## Financial status values

Every status the API returns is documented here. **None imply realized revenue, verified
settlement, or that funds moved.** Live partner execution is still `POST /api/v1/executions` → 501.
The revenue-recognition chain is:

```
Route View ≠ Route Selection ≠ Execution Intent ≠ External Provider Execution ≠ Verified Settlement ≠ Realized Revenue
```

`fundsMoved`, `custody`, and `realExecution` stay `false` on every implemented payload.

| Family | Status | Financial meaning | Realized revenue |
| ------ | ------ | ----------------- | ---------------- |
| payment_intent | `CREATED` | Intent accepted. No quote yet. No funds reserved or moved. | no |
| payment_intent | `QUOTING` | Router is collecting indicative quotes. Not an execution in flight. | no |
| payment_intent | `QUOTED` | Indicative quotes attached. Route view only. Not a selection and not a payment. | no |
| payment_intent | `ROUTED` | A quoted route was selected. Daily simulated spend is reserved. Not provider execution. | no |
| payment_intent | `POLICY_APPROVED` | Policy Engine approved the selected route. Not card authorization and not a funds hold. | no |
| payment_intent | `SIMULATION_PENDING` | Sandbox simulator is about to run. No external provider is instructed. | no |
| payment_intent | `SIMULATION_COMPLETED` | Sandbox simulator finished. fundsMoved stays false. Not verified settlement or realized revenue. | no |
| payment_intent | `FAILED` | Intent processing failed (policy or simulation). No rail payment was submitted, so none failed at a partner. | no |
| payment_intent | `EXPIRED` | Intent or quote validity window elapsed. Pricing must be re-quoted. No funds moved. | no |
| execution_intent | `recorded` | Route choice persisted. executable and submitted stay false. Not provider execution. | no |
| transaction_request | `draft` | Customer request recorded, not yet priced. Not a payment. | no |
| transaction_request | `quoted` | At least one live indicative quote. Route view only. | no |
| transaction_request | `quotes_expired` | Every quote passed expiry. Re-quote required. No funds moved. | no |
| transaction_request | `quote_selected` | Customer indicated which quote they intend to use. Non-binding. No funds move. | no |
| transaction_request | `cancelled` | Withdrawn by the customer or the platform. Not a reversed settlement. | no |
| quote | `active` | Indicative quote still inside its freshness window. Non-binding. | no |
| quote | `expired` | Quote past expiresAt. Must not be ranked or selected. | no |
| quote | `superseded` | Replaced by a newer quote from the same provider for the same request. | no |
| quote | `withdrawn` | Provider withdrew or declined the price. Not a chargeback. | no |
| invoice | `issued` | Platform-fee invoice generated from monetization snapshots. Not cash received and not realized revenue. | no |
| invoice | `uncollected` | Collection is deferred. An issued invoice is not confirmed payment or realized revenue. | no |

Retired payment-intent names (`AUTHORIZED`, `EXECUTION_PENDING`, `COMPLETED`) are not valid and are
not aliased. A future `SETTLEMENT_CONFIRMED` status does not exist in this tree.

---

## `GET /api/v1/health`

The service health contract. A fixed three-field response, no envelope, nothing derived from runtime
state — a health check that changes shape as the service evolves eventually breaks the monitor
watching it.

```json
{ "status": "ok", "service": "financial-router", "version": "1.0.0" }
```

`version` versions the HTTP contract, not the deployed build. The build is identified by
`engineVersion` and the pricing dataset version from `/api/v1/meta`, both of which move
independently.

## `GET /health`

Liveness, unversioned and unauthenticated so an orchestrator need not track API versions and a probe
cannot fail because a proxy attached a credential. Returns the service identity plus `mode`,
`engineVersion` and `uptimeSeconds`. No envelope.

## `GET /ready`

Readiness: verifies the persistence store is reachable and its schema present. `200` when ready,
`503` otherwise. Keep this separate from `/health` so a database blip does not get a healthy
process restarted.

## `GET /api/v1/meta`

Everything a client needs to build a request: product identity, routing pipeline, platform mode,
engine version, declared capabilities, rail families, interaction models, pricing dataset versions,
registered providers, rails (with family and `available` / `planned` status), supported currencies
with their minor-unit exponents, the default scoring weights, and `apiSurfaces` (public vs
authenticated quote classification plus the OpenAPI path).

The `capabilities` block is the machine-readable form of the compliance boundary
(`PLATFORM_CAPABILITIES` in core — do not fork a second copy):

```json
{
  "compareRoutes": true,
  "executeTransactions": false,
  "delegateExecution": false,
  "custodyFunds": false,
  "holdCryptoAssets": false,
  "holdPrivateKeys": false,
  "controlCustomerWallets": false,
  "operateAsPrincipal": false,
  "issueStablecoins": false,
  "agentPayments": true,
  "agentPaymentSimulation": true,
  "agentNaturalLanguageRouting": true,
  "defiQuotes": true,
  "defiExecution": false,
  "multiRailRouting": true,
  "routeGraph": true,
  "stablecoinRouting": true,
  "defiLiquidityRouting": true,
  "financialRoutingApi": true,
  "paymentPolicyEngine": true,
  "executionIntents": true,
  "multiRailMonetization": true,
  "agentFinancialDashboard": true,
  "b2bOnboarding": true,
  "platformInvoicing": true,
  "mandateIngestion": true,
  "executionPartnerAdapters": true
}
```

`execution.delegated` is false. `pipeline` names Discover → Delegate; only `delegate` is `planned`.
`railFamilies` lists `tradfi` and `stablecoin` as available and `defi` as planned for the
comparison engine. `providerCatalog` lists every `FinancialProvider`, including read-only DeFi
demos that are not in `providers`. `defiQuotes` is true; `defiLiquidityRouting` is true;
`defiExecution` is false. `defiRoutingEngineVersion` is **1.0.0**. `financialRoutingApi` and
`executionIntents` are true: `POST /api/v1/quote` and `POST /api/v1/routes/search` are the
authenticated routing API; `transaction:create` records an intent, it does not pay.
`agentPayments`, `agentPaymentSimulation` and `agentNaturalLanguageRouting` are true: agents may
create payment intents, interpret natural language into structured intent, and run the sandbox
simulator. They still cannot move money. The NL parser does not compute rates, fees, slippage or
settlement amounts. `mandateIngestion` is true (the code exists) and `GET /meta` also publishes
`mandateIngestionEnabled` from `MANDATE_INGESTION_ENABLED` (**default false**). Verification and
storage of signed AP2 / x402 / MPP mandates never executes, holds keys, or moves funds.
`executionPartnerAdapters` is true: sandbox mocks can receive a caller-signed instruction and
report partner status. `GET /meta` publishes `partnerLiveEnabled` from `PARTNER_LIVE_ENABLED`
(**default false**). No live adapter is registered. `POST /executions` remains 501.
`paymentPolicyEngine` is true: every agent request is evaluated fail-closed
before quotes, authorization, simulation, and execution-intent recording. `multiRailMonetization`
is true: quoted TPV, platform revenue, provider cost, partner commission, gross profit and take
rate are attributed on the revenue dashboard. `agentFinancialDashboard` is true: organization
operators can inspect agent volume, fees, success rate, spending limits and policy denials, and
patch allow-lists. The dashboard never custodies funds, holds keys, or generates wallets.
`b2bOnboarding` is true: sales-assisted invite-only onboarding with fail-closed KYB and explicit
CustomerPricing. Completing onboarding does not enable execution.
`POST /api/v1/executions` remains 501.

## `GET /api/v1/openapi.json`

Machine-readable OpenAPI 3 contract for every `/api/v1` route. Public. Each operation is tagged
`x-meridian-surface: public | authenticated` and `x-meridian-auth`. The same table is published on
`GET /api/v1/meta` under `apiSurfaces`. Tests fail if a Fastify handler is added without a catalog
row.

Agent credential issuance: [AGENTS.md](./AGENTS.md).

## Public vs authenticated quote surfaces

Public discovery and the authenticated billed quote **share MultiRailRouter**. They are not the
same HTTP contract.

| Surface | Routes | Auth | Ranking | Response |
| ------- | ------ | ---- | ------- | -------- |
| Public discovery | `POST /comparisons`, `POST /routes`, `POST /stablecoin-routes`, `POST /defi-routes`, `POST /provider-quotes`, graph/catalog GETs | None. Anonymous is served. | Platform-default or request weights. No organization payment policy. | Indicative. Catalog provider names (same as `GET /providers`). `POST /routes` includes quoted `monetization` with `realizedRevenue: false` and `fundsMoved: false` (PA-H08). No `quoteExpiresAt`. No billed Quote row. |
| Authenticated billed quote | `POST /quote` | `quote:read` (session, `mk_`, or `mag_`). Anonymous is **401**. | Same engine. `organizationId` from the verified principal. | Slim DTO: `requestId`, `routes`, `recommendedRoute`, `quoteExpiresAt`. **No** `monetization` object (take-rate / TPV figures stay on discovery `/routes` as quoted, unrealized economics). |
| Authenticated path discovery | `POST /routes/search` | `route:read`. Anonymous is **401**. | Graph + catalog. Not a second quote engine. | Paths and matching providers. `executable: false`. |
| Agent payment quote | `POST /payment-intents/:id/quote` | `mag_` `payment:quote` | Same MultiRailRouter. Policy `preferredRoutePreference` is the ranking-weight input; allowlists filter the ranked set. Empty allowlist is `POLICY_DENIED`, never a silent fallback. | Payment-intent DTO with `quotedRoutes`. |

Using public `/routes` is **not** an authentication bypass of `/quote`. `/quote` is the
org-scoped billed window (`quoteExpiresAt`). Public `/routes` is indicative discovery; its
monetization snapshot is a `ROUTE_QUOTE`, never realized revenue. Dashboard revenue aggregation
is authenticated-only.

## `GET /api/v1/providers`

The multi-rail catalog: wrapped comparison rails plus demo ramp, DEX, AMM and aggregator. Each row has
`category` (`traditional` | `stablecoin` | `defi`), `features`, `conversionKinds`, supported
assets and supported ISO currencies.

## `GET /api/v1/providers/:providerId`

One catalog entry, or `404`.

## `POST /api/v1/provider-quotes`

Indicative quote from one catalog provider. Not a comparison, and never executable.

```jsonc
{
  "providerId": "demo-meridian-pool",
  "sourceAsset": "USDC",
  "targetAsset": "ETH",
  "amount": "10000.00",
}
```

`sourceAsset` / `targetAsset` are catalog assets (`USD`, `USDC`, `ETH`, …), not only ISO
currencies. The schema is strict: `execute`, `privateKey`, `wallet` and beneficiary fields are
rejected. `data.executable` is always `false`.

## `POST /api/v1/routes`

Multi-rail routing engine **2.0.0**. Evaluates Traditional Finance, stablecoin and DeFi quotes
with one multi-objective scorer (cost, speed, finality, FX rate, slippage, liquidity, compliance).
Rail health and liquidity observations deprioritize degraded or dry rails and fail over down
rails. `POST /comparisons` uses this same MultiRailRouter (`routingEngineVersion` **2.0.0**). The
fiat library constant `ENGINE_VERSION` **2.0.0** remains on `GET /meta` and is not the comparison
ranking engine. No model is used for any figure. Request weights must lie in the published
0–1 policy range and sum to exactly 1.

```jsonc
{
  "sourceAsset": "USD",
  "destinationAsset": "KRW", // `targetAsset` accepted as a synonym
  "amount": "100000.00",
  "preferences": {
    "weights": {
      // optional; must sum to exactly 1 and stay inside objectiveBounds
      "cost": "0.30",
      "speed": "0.15",
      "finality": "0.10",
      "fxRate": "0.15",
      "slippage": "0.10",
      "liquidity": "0.10",
      "compliance": "0.10"
    }
  }
}
```

`organizationId` is taken from the authenticated principal, never the body. The schema is strict:
`execute`, keys and beneficiary fields are rejected.

Returns `201` with:

- `routes[]` — ranked best-first, each with hops, economics, score components,
  `railHealth`, structured `bestExecution` attestation, and `routeExplanation`
- `recommendedRoute` — the rank-1 route
- `routeScore`, `estimatedCost`, `estimatedReceiveAmount`, `estimatedSettlementTime`,
  `routeExplanation` — echoed from the recommendation
- `plannedRoutes` — Route D (fiat → stablecoin → DEX → fiat) is declared, not composed
- `aiUsed: false`
- `fingerprint` — SHA-256 of the ranking snapshot stored for replay. The snapshot JSON is not
  returned.
- `monetization` — quoted economics for the recommended route (`ROUTE_QUOTE`): provider cost,
  platform fee, partner commission, gross margin, take rate, TPV basis. `realizedRevenue` is
  always `false`. Discovery does not create realized revenue.

## `POST /api/v1/routes/:routingId/replay`

Re-runs `MultiRailRouter` over the stored ranking snapshot for a public `/routes` evaluation.
Returns whether the ranked route ids and fingerprint reproduced. The snapshot JSON is not in the
response. Cross-surface ids (a billed `/quote` evaluation) are `404`. Quoted monetization on the
replayed routing DTO still has `realizedRevenue: false`.

## `POST /api/v1/simulate`

Pre-execution simulation. Ranks the same MultiRailRouter (or replays a stored `routingId`) and
returns expected all-in cost, slippage and settlement-time distributions. Quotes are mock or
historical sandbox data. `fundsMoved`, `executable` and `livePartnerCalled` are always `false`.
No live settlement partner is called. The recommended route's `bestExecution` attestation is
included so a later sandbox receipt can bind the same rationale hash.

```jsonc
{
  "sourceAsset": "USD",
  "destinationAsset": "KRW",
  "amount": "500.00",
  "preferences": { "weights": { "cost": "1", "speed": "0", "finality": "0", "fxRate": "0", "slippage": "0", "liquidity": "0", "compliance": "0" } },
  "routingId": "rte_...", // optional: replay a stored public ranking
  "routeId": "sandbox-veridian-payments:payment_institution" // optional: simulate a non-recommended path
}
```

USD 100,000 → KRW still returns **four** routes on `POST /comparisons`. The routing engine may
return those same wrapped rails plus catalog-only venues when the corridor is on-chain or a ramp.

## `GET /api/v1/route-graph`

Demo financial-route graph. Nodes are assets (`FIAT`, `STABLECOIN`, `CRYPTO_ASSET`) and venues
(`BANK`, `FX_PROVIDER`, `PAYMENT_PROVIDER`, `DEX`, `AMM`, `LIQUIDITY_POOL`, `SETTLEMENT_PROVIDER`).
Edges are directed conversions with indicative `costBps` and liquidity. `executable` is always
`false`. `graphEngineVersion` is **1.0.0**.

## `POST /api/v1/route-graph/paths`

Constrained multi-hop path discovery on that graph. Distinct from `POST /routes` (live quotes) and
`POST /comparisons` (fiat scoring). No model is used. No chain is contacted.

```jsonc
{
  "sourceAsset": "USD",
  "destinationAsset": "KRW", // `targetAsset` accepted as a synonym
  "constraints": {
    "maxHops": 3,                 // 1–8; default 4
    "maxExpectedCostBps": "80",   // optional cumulative ceiling
    "minLiquidity": "1000.00",    // optional, major units of the source asset
    "supportedAssets": ["USD", "USDC", "USDT", "KRW"]
  }
}
```

`organizationId` is taken from the principal. The schema is strict: `execute`, keys and beneficiary
fields are rejected.

Returns `201` with ranked `paths[]` (fewest hops, then lowest indicative cost), `recommendedPath`,
constraint rejections (`UNAVAILABLE_EDGE`, `HIGH_COST`, `INSUFFICIENT_LIQUIDITY`, `CYCLE`, …),
`aiUsed: false`, `executable: false`.

Examples the demo graph can discover:

- one hop: `USD → Veridian Payments → KRW`
- two hop: `USD → Helios Ramp → USDC → Helios Ramp → KRW`
- three hop: `USD → USDC → USDT → KRW`

An asset is never revisited on the same walk.

## `GET /api/v1/stablecoins`

Demo stablecoin catalog and chain metadata. Today: USDC and USDT. Each listing names a default
settlement chain (CAIP-2) with `connected: false` and `rpcUrl: null`. Adding a stablecoin later is
a registry row — this endpoint does not encode ticker-specific logic. `stablecoinRoutingEngineVersion`
is **1.0.0**. Custody, wallets, private keys and execution flags are all `false`.

## `POST /api/v1/stablecoin-routes`

Stablecoin routing layer. Prices **fiat → stablecoin**, **stablecoin → fiat** and
**stablecoin → stablecoin** only. Distinct from `POST /routes` (every rail) and `POST /comparisons`
(fiat scoring). Cost math is the shared multi-rail cost engine; ranking is by indicative cost, then
settlement time. No model is used. No chain is contacted.

```jsonc
{
  "sourceAsset": "USD",
  "destinationAsset": "USDC", // `targetAsset` accepted as a synonym
  "amount": "10000.00"
}
```

`organizationId` is taken from the principal. The schema is strict: `execute`, keys, wallets and
beneficiary fields are rejected.

Returns `201` with ranked `routes[]`. Each route carries:

- `asset` — source and destination codes
- `chain` — source, destination and settlement metadata (`connected` always false)
- `price` — indicated and mid
- `providerFee`, `networkFee`
- `slippage` — bps plus the provider's model
- `liquidity` — disclosed depth, venue, chain
- `estimatedSettlementTime`
- `expiration`

Top-level flags `custody`, `connectedToMainnet`, `walletsCreated`, `privateKeysGenerated`,
`executable` and `delegateExecution` are always `false`. `aiUsed` is always `false`.

USD → KRW and USDC → ETH are **400** on this endpoint (wrong conversion kind). USDT → KRW is
**422** (no demo provider prices it). USD 100,000 → KRW still returns **four** routes on
`POST /comparisons`.

## `GET /api/v1/defi-liquidity`

Demo DeFi liquidity catalog. Pools: USDC/USDT, ETH/USDC, ETH/USDT. Venues: DEX, AMM, aggregator,
each exposing `getQuote`, `getLiquidity`, `getSwapFee`, `getEstimatedSlippage`, `getNetworkFee`,
`getSupportedTokens` and `getSupportedChains`. Chain metadata lists Ethereum (quoting available),
Base, Arbitrum, Sepolia and Solana (planned). Every chain has `connected: false` and `rpcUrl: null`.
`defiRoutingEngineVersion` is **1.0.0**. Custody, wallets, private keys, swap submission and
execution flags are all `false`.

## `POST /api/v1/defi-routes`

DeFi liquidity routing layer. Quotes DEX, AMM and aggregator venues, and ranks a **stablecoin**
or **traditional FX** quote on the same pair when a catalog provider can price it. Distinct from
`POST /routes` (every rail, scored) and `POST /stablecoin-routes` (fiat ↔ stablecoin only). Cost
math is the shared multi-rail cost engine; ranking is by indicative cost, then settlement time.
No model is used. No chain is contacted. No swap is submitted.

```jsonc
{
  "sourceAsset": "USDC",
  "destinationAsset": "USDT", // `targetAsset` accepted as a synonym
  "amount": "10000"
}
```

`organizationId` is taken from the principal. The schema is strict: `execute`, keys, wallets and
beneficiary fields are rejected.

Returns `201` with ranked `routes[]` and `recommendedExecutionRoute` (same as `recommendedRoute`;
never executable). Each route carries:

- `routeKind` — `dex` | `amm` | `aggregator` | `stablecoin` | `traditional`
- `venueKind` — DEX/AMM/aggregator kind, or `null` on a ramp or FX desk
- `asset`, `chain` (`connected` always false)
- `price` — indicated and mid
- `swapFee`, `networkFee`
- `estimatedSlippage` — bps plus the provider's model
- `liquidity` — disclosed depth, venue, chain
- `estimatedSettlementTime`, `expiration`

Top-level flags `custody`, `connectedToMainnet`, `walletsCreated`, `walletsConnected`,
`privateKeysGenerated`, `swapSubmitted`, `executable` and `delegateExecution` are always `false`.
`aiUsed` is always `false`.

USDC → USDT returns three DeFi venues. ETH → USDC and ETH → USDT quote the demo pools. USD → KRW
compares traditional FX with a stablecoin ramp. USD → USDC quotes Helios. USD 100,000 → KRW still
returns **four** routes on `POST /comparisons`. Adding a chain later is a registry row — this
engine does not switch on Ethereum, Base, Arbitrum or Solana.

## `POST /api/v1/comparisons`

Ranks every eligible catalog route for a fiat corridor through **MultiRailRouter** (same engine as
`POST /routes`, `engineVersion` **2.0.0**). `RouteComparisonService` is not on this path.

```jsonc
{
  "sourceCurrency": "USD",
  "targetCurrency": "KRW",
  "amount": "100000.00", // major units, no more precision than the currency allows
  "rails": ["bank_fx"], // optional; omit for every rail
  "railFamilies": ["tradfi"], // optional; intersected with `rails`; planned families 400
  "weights": {
    // optional; must sum to exactly 1
    "cost": "0.6",
    "speed": "0.3",
    "reliability": "0.1",
  },
}
```

The schema is **strict**: unknown fields are rejected. That is deliberate — it stops beneficiary
names, account numbers or identity data being sent to a platform with no lawful basis to store them.

Returns `201` with a comparison containing:

- `routes` — ranked best-first, each with `totalCost`, `totalCostPercent`, `deliveredAmount`,
  `benchmarkAmount`, `midMarketRate`, `offeredRate`, `effectiveRate`, `slippageBps`, `settlement`,
  a full `breakdown`, a `score` and its `scoreComponents`, and `quote.freshness` (`ageMs`,
  `ageSeconds`, `state`, `maxAgeMs`) so a client can see how fresh each compared rail was.
  Quotes past `expiresAt` or older than the rail freshness window are omitted from `routes` and
  appear in `providerFailures` (`QUOTE_EXPIRED` / `QUOTE_STALE`).
- `recommendedRouteId` — the rank-1 route.
- `insights` — cheapest, fastest and most expensive routes, plus savings against the most expensive
  route and against the cheapest bank-FX baseline.
- `providerFailures` — providers that could not quote. A dead provider degrades the comparison
  rather than failing the request.
- `fingerprint` — SHA-256 over the canonical snapshot. See replay below.

### Worked example

`USD 100,000 → KRW` in sandbox mode returns four routes:

| Rank | Provider            | Rail               | All-in cost | Settlement     |
| ---- | ------------------- | ------------------ | ----------- | -------------- |
| 1    | Solstice Settlement | Stablecoin partner | 0.34%       | 5 min          |
| 2    | Aperture Liquidity  | Liquidity provider | 0.38%       | 30 min         |
| 3    | Veridian Payments   | FX provider        | 0.48%       | 2 hours        |
| 4    | Northgate Bank      | Bank FX            | 0.72%       | 1 business day |

Cost is measured against the mid-market benchmark, which is why a bank quoting "no fees" on a
69 bps spread lands last.

## `GET /api/v1/comparisons/:comparisonId`

Returns the stored comparison **verbatim**, exactly as it was quoted. Re-reading a comparison shows
the prices as they were, not as they are now — which is the point of persisting it.

## `GET /api/v1/comparisons?limit=20`

Summaries of recent comparisons, newest first. Supports the shared cursor-pagination contract
(`limit`, `cursor`, `meta.nextCursor`).

## `POST /api/v1/comparisons/:comparisonId/replay`

Re-runs the engine over the stored snapshot and reports whether the calculation reproduced:

```json
{
  "comparisonId": "cmp_...",
  "reproducible": true,
  "originalFingerprint": "74e707e2...",
  "replayedFingerprint": "74e707e2...",
  "replayedAt": "2026-03-01T09:00:02.000Z",
  "comparison": { "...": "..." }
}
```

This is how rule 13 is verified rather than asserted: the snapshot holds the request, the raw
provider quotes, the provider descriptors and the scoring weights, so the identical result is
derivable at any later time regardless of what the market has done since.

## `GET /api/v1/comparisons/:comparisonId/audit`

The append-only audit trail for one comparison: `comparison.requested`, one
`provider.quote.received` or `provider.quote.failed` per provider, `comparison.completed`, and any
`comparison.replayed` events.

## `POST /api/v1/auth/login`

```json
{ "email": "treasury@demo-trading.example.invalid", "password": "MeridianDemo!2026" }
```

Returns `201` with `token`, `expiresAt`, `user`, `organization` and `role`. Unknown email and wrong
password share one error message. The token is shown once; only its hash is stored.

When the user has enrolled TOTP, this endpoint returns `202` with `mfaRequired`, `challengeToken`
and `expiresAt` instead of a session. Complete sign-in with `POST /api/v1/auth/mfa/verify`.
Organizations may require MFA for owner/admin; that flag is off by default. See [AUTH.md](./AUTH.md).

## `POST /api/v1/auth/mfa/verify`

Public. `{ challengeToken, code }` where `code` is a TOTP or a single-use recovery code. Issues the
same session as password login.

## `GET /api/v1/auth/mfa` / `POST /api/v1/auth/mfa/enroll` / `POST /api/v1/auth/mfa/confirm`

Authenticated human session. Enrollment returns the TOTP secret once; confirm returns recovery
codes once. Secrets are AES-256-GCM at rest.

## `POST /api/v1/auth/oidc/start` / `POST /api/v1/auth/oidc/callback`

Public OIDC start/callback. Start takes `{ organizationSlug }`. Callback takes `{ code, state }`.
Unmapped federated identities are rejected. Issued sessions use PA-H02 scopes for the existing
membership role.

## `PATCH /api/v1/dashboard/settings/auth`

Owner/admin. Toggles `requireMfaForPrivilegedRoles` and writes org OIDC config. Client secrets are
write-only.

## `POST /api/v1/auth/logout`

Revokes the session presented in `Authorization`. Idempotent for anonymous callers.

## `GET /api/v1/auth/me`

The verified principal's user, organization and role. `401` without a credential.

## B2B onboarding (sales-assisted, invite-only)

Self-service signup is not offered. An internal operator with `ONBOARDING_OPERATOR_SECRET` creates
the `Organization`, issues the first owner `OrganizationMember` invite, records a KYB decision, and
attaches an explicit `CustomerPricing` row. New organizations default to `kybStatus: unverified`,
no pricing, no API key, and no elevated scopes.

KYB vendor: **manual review** (no contractually confirmed vendor). Automated KYB is a future
adapter behind the same fail-closed `KybVendor` port — vendor errors never auto-approve.
Pricing model: existing negotiated `CustomerPricing` rules feeding `priceRouteMonetization`. There
is **no silent default take-rate**. An organization is `realTransactionEligible` only when
`kybStatus === "verified"` **and** at least one in-force `CustomerPricing` row exists (including an
agreed `markupBps` of `"0"`).

Sandbox `/quote` remains available for unverified orgs. Production-locked `/quote` and
`/routes/search` return `403 ONBOARDING_INCOMPLETE` until eligible. Public `POST /comparisons` is
unchanged. `POST /api/v1/executions` remains `501`. Completing onboarding does not enable
execution and does not invent a licensed provider (PHASE 30 is still blocked).

### `POST /api/v1/ops/onboarding/organizations`

Operator header required. Creates the organization and an owner invite. The raw invite token
(`miv_…`) is returned **once**; only a hash is stored. Invite TTL is 7 days.

```jsonc
{
  "name": "Northwind Treasury",
  "slug": "northwind-treasury",
  "countryCode": "SG",
  "ownerEmail": "owner@northwind.example.invalid",
  "ownerDisplayName": "Northwind Owner"
}
```

`201` with `kybStatus: "unverified"`, `pricingConfigured: false`, and `invite.token`. Duplicate
slug is `400`. Missing/wrong operator key is `401` (same either way).

### `POST /api/v1/onboarding/invites/accept`

Public. Body: `token`, `password` (required when the invited user has no password yet; min 12
characters; demo secrets rejected), optional `displayName`. Activates the invited membership.
Does not verify KYB or attach pricing.

### `GET /api/v1/dashboard/onboarding`

Organization session. Returns the live checklist: organization created, KYB status, whether
pricing is configured, whether an API key exists, `realTransactionEligible`, and
`licensedProviderConfigured`. Completeness is backend state.

### `POST /api/v1/dashboard/onboarding/kyb/submit`

Owner or admin session. Submits KYB while `unverified` → `pending`. The interim vendor is
`manual_review` and always returns pending. A vendor error leaves the org unverified.

### `POST /api/v1/ops/onboarding/organizations/:id/kyb`

Operator. Body: `{ "status": "verified" | "rejected", "reason": "..." }` (reason min 3 chars).
Audited as `onboarding.kyb.reviewed` with actor and reason.

### `POST /api/v1/ops/onboarding/organizations/:id/pricing`

Operator. Body requires explicit `markupBps` (non-negative decimal string). Optional
`discountBps`, `platformFeeMinorUnits`, `notes`. Inserts a blanket `CustomerPricing` row (any
corridor / any rail). Does not bypass `priceRouteMonetization`.

Audit events: `onboarding.organization.created`, `onboarding.invite.issued`,
`onboarding.invite.accepted`, `onboarding.kyb.submitted`, `onboarding.kyb.reviewed`,
`onboarding.pricing.configured`. Invite tokens and the operator header are redacted from logs.

## `GET /api/v1/dashboard/metrics`

Organization-scoped totals and 30-day charts, computed from stored quotes and transaction requests:

- total quoted volume (request notional, not quote notional)
- estimated savings (recommended vs most expensive quote per request)
- quote count
- successful route requests
- average route cost (bps of recommended quotes)
- average settlement estimate (p50 of recommended quotes)

`charts.volumeByDay`, `charts.costByDay` and `charts.providers` are the same store, filtered to this
organization.

## `GET /api/v1/dashboard/revenue`

Organization-scoped multi-rail monetization report. Amounts are integer minor units. Arithmetic is
Decimal only. `fundsMoved` is always false.

Totals: TPV, gross revenue, provider cost, platform revenue, partner commission, gross profit, take
rate, realized (settled-stage only), invoiced, collected. Breakdowns: rail, provider, currency,
asset, organization, AI agent, transaction type, revenue source, date. Includes the canonical
$100,000 worked example. Invoiced is not collected. Realized stays zero until a verified external
settlement exists.

Anonymous callers are `401`. Another tenant's events never appear.

## `GET /api/v1/dashboard/invoices`

Organization-scoped issued platform-fee invoices. Amounts are integer minor units copied from
monetization snapshots — billing never recomputes take-rate. `collectionStatus` is `uncollected`.
`realizedRevenue` and `collected` are always false. Payment collection is deferred.

PHASE 35 did **not** change this. Legal entity, tax treatment, and a named processor (or an
explicit bank-transfer-only decision) were not confirmed outside Cursor, so
`DeferredPlatformFeeCollector` was left in place. `issuerLegalEntity` remains `"unconfirmed"`.
Tax remains `"0"` as a documented gap, not a calculated rate.

PHASE 36 did **not** add recurring subscription line items, a plan catalog, or partner-payout
history. `enterprise_subscription` snapshots, when present, are still billed as PHASE 32 invoice
lines copied from monetization — not as a confirmed monthly SKU. Partner commission remains a
field on those snapshots, not accounts payable.

## `GET /api/v1/dashboard/invoices/:id`

One invoice for this organization, including line items that each name a `monetizationEventId`.
`404` for an unknown id or another organization's invoice.

## `POST /api/v1/ops/billing/invoices/run`

Operator-authenticated (`X-Onboarding-Operator-Key` vs `ONBOARDING_OPERATOR_SECRET`). Body:
`{ "periodStart": "YYYY-MM-01T00:00:00.000Z", "organizationId?": "..." }`.

Generates one invoice per organization per UTC calendar month per currency from billable snapshots:

- `economicStage === "execution_intent"` with positive platform revenue, or
- `transactionType === "enterprise_subscription"` with positive platform revenue

`route_quote` (route view) is never billed. Totals are bigint sums of copied
`platformRevenueMinorUnits`. Tax is always `"0"` (`taxCalculation: "deferred"`).
`issuerLegalEntity` is `"unconfirmed"`. Unique `(organizationId, periodStart, currency)` makes a
second run return the existing invoice (no double-bill). Unique `invoice_lines.monetization_event_id`
prevents the same snapshot appearing on two invoices.

## `POST /api/v1/ops/live-enablement`

Operator-authenticated. Records a per-corridor, per-partner, or billing live flag. Body must include
complete `signOff` (`approvedBy`, `licenseBasis`, `approvedAt`, `expiresAt`, `checklistRef` matching
[`GO_LIVE_CHECKLIST.md`](../GO_LIVE_CHECKLIST.md)). Missing metadata is `400`; the path stays sandbox.
`liveFundsMovementActive` in the response is always `false` in this repository.

## `GET /api/v1/ops/live-enablement/evaluate`

Operator-authenticated. Reports whether corridor/partner sign-off is current, whether a region kill
switch is engaged, and why live funds movement remains inactive (process flag, expiry, missing
adapter). Licence expiry fail-closes without waiting for an operator.

## `POST /api/v1/ops/billing/collect`

Operator-authenticated. Attempts platform-fee collection. `403` while `BILLING_LIVE_ENABLED` is
false (the default), when billing sign-off is missing or expired, when the legal entity is
unconfirmed, or when no processor adapter exists. Never writes `collected`. Same fail-closed
contract: `POST /ops/billing/subscriptions/run`, `POST /ops/billing/partner-payouts/run`.

Issued invoices set snapshot `revenueRecognition` to `invoiced` and `invoiceId`. `realizedRevenue`
stays false. Collection is not implemented.

Missing or wrong operator key: `401` (same as onboarding ops).

## `GET /api/v1/ops/billing/reconciliation`

Operator-authenticated. Query `periodStart` as above. Internal report: quoted platform revenue vs
billable vs invoiced vs collected (`"0"`) vs unbilled billable, plus billed snapshot IDs and any
duplicate IDs (should be empty).

## `GET /api/v1/dashboard/agents`

Organization-scoped AI-agent financial summaries. Volume, transaction count, average fee, route
success rate, preferred route, daily spend and policy-violation count. Amounts are integer minor
units. Arithmetic is Decimal/`bigint` only. `fundsMoved`, `custody`, `walletsGenerated` and
`privateKeysHeld` are always false.

Anonymous callers are `401`. Another tenant's agents never appear.

## `GET /api/v1/dashboard/agents/:id`

Detail for one agent in this organization: spending snapshot, preferred routes, policy violations.
`404` for an unknown id or another organization's agent.

## `GET /api/v1/dashboard/agents/:id/payments`

Payment history (serialized intents) for one agent. `SIMULATION_COMPLETED` is sandbox simulation
only (`fundsMoved: false`, `realExecution: false`).

## `GET /api/v1/dashboard/agents/:id/policies`

Policy, spending remaining, violations, and the allow-list controls (assets, providers, recipients,
route preferences). Empty allow-lists mean none.

## `PATCH /api/v1/dashboard/agents/:id/policies`

Requires the `agent_policy:write` capability (`owner` and `admin` sessions). `viewer`, `member`,
agent credentials, and organization API keys are `403`. Body fields are optional; omitted limits are
left unchanged. Spending amounts are integer minor-unit strings. A successful mutation writes
`payment.policy.updated` with actor id, actor role, organization id, agent id, previous and new
policy snapshots, and timestamp.

## `GET /api/v1/dashboard/quotes`

## `GET /api/v1/dashboard/quotes/:id`

## `GET /api/v1/dashboard/transactions`

## `GET /api/v1/dashboard/transactions/:id`

## `GET /api/v1/dashboard/providers`

## `GET /api/v1/assets`

Public catalog of `ASSET_REGISTRY` (fiat, stablecoins, crypto) with decimals and optional networks.

## `GET /api/v1/currencies`

Public ISO 4217 catalog from `CURRENCY_REGISTRY`.

## `POST /api/v1/quote`

Authenticated financial quote. Requires a verified organization and `quote:read`. Wraps the
multi-rail engine (`routingEngineVersion` 2.0.0) and returns a slim DTO. Optional `organizationId`
in the body is a claim that must match the principal — it is never the source of truth.

```jsonc
{
  "sourceAsset": "USD",
  "destinationAsset": "KRW",
  "amount": "100000.00",
  "organizationId": "org_...",
  "preferences": {
    "weights": {
      "cost": "0.30",
      "speed": "0.15",
      "finality": "0.10",
      "fxRate": "0.15",
      "slippage": "0.10",
      "liquidity": "0.10",
      "compliance": "0.10"
    }
  }
}
```

```jsonc
{
  "requestId": "req_...",
  "routes": [ { "routeId": "...", "executable": false } ],
  "recommendedRoute": { "routeId": "..." },
  "quoteExpiresAt": "2026-03-01T09:15:00.000Z",
  "routingId": "rte_...",
  "fingerprint": "74e707e2..."
}
```

Anonymous callers are `401`. A mismatched `organizationId` is `403`. Missing `quote:read` is `403`.
When the process is production-locked, incomplete onboarding (`kybStatus` not `verified` and/or no
explicit `CustomerPricing` row) is `403 ONBOARDING_INCOMPLETE`. Sandbox `/quote` is not gated that
way. `POST /api/v1/routes` remains the **public** (unscoped) multi-rail discovery endpoint. It is not
the billed `/quote` surface; see [Public vs authenticated quote surfaces](#public-vs-authenticated-quote-surfaces).

## `POST /api/v1/quote/:routingId/replay`

Requires `quote:read`. Replays a billed quote ranking. The response quote DTO has **no**
`monetization` field (PA-M05). Anonymous is `401`. A `/routes` evaluation id is `404`.

## `POST /api/v1/routes/search`

Authenticated path discovery. Requires `route:read`. Returns graph paths plus catalog providers that
support the pair. Does **not** run a second live quote engine. `executable` is always `false`.

```jsonc
{ "sourceAsset": "USD", "destinationAsset": "USDC" }
```

## `GET /api/v1/api-keys`

## `POST /api/v1/api-keys`

## `POST /api/v1/api-keys/:id/revoke`

Owner or admin sessions only. Service keys cannot mint keys. Create returns the secret **once**.
Default scopes are `quote:read` and `route:read`. Optional `scopes` and `expiresAt`. List returns
prefixes, never secrets or hashes.

## `POST /api/v1/execution-intents`

## `GET /api/v1/execution-intents`

Cursor-paginated list for the caller's organization (`limit`, `cursor`, `meta.nextCursor`).

Requires `transaction:create` (organization API keys minted with that scope — never human sessions).
Records a route choice with `status: "recorded"`, `executable: false`, `submitted: false`. This is
not a payment. An expired `quoteExpiresAt` is rejected with `409 QUOTE_EXPIRED` (`requoteRequired:
true`) and audited as `execution.intent.rejected` **before** Policy Engine evaluation. A payment
intent id that has already passed the Policy Engine (`ROUTED`, `POLICY_APPROVED`, `SIMULATION_PENDING`, or
`SIMULATION_COMPLETED`) is required; omitting it is `403 POLICY_DENIED` (`policy_required`). The gate
re-evaluates policy fail-closed immediately before persist. `POST /api/v1/executions` remains the
audited `501`.

## AI agent payments

Agents authenticate with `X-Api-Key: mag_...` (hashed, revocable). Issuance, scopes, and
revocation are documented in [AGENTS.md](./AGENTS.md) and match `POST /api/v1/agents`. Human
sessions never receive `payment:*` scopes; only `mag_` credentials drive the agent payment API.
Organization `mk_` keys do not receive payment scopes by default.

| Method | Path | Scope |
| ------ | ---- | ----- |
| POST | `/api/v1/agents` | owner/admin session |
| GET | `/api/v1/agents` | organization |
| GET | `/api/v1/agents/me` | agent |
| POST | `/api/v1/agents/:id/revoke` | owner/admin session |
| GET | `/api/v1/merchants` | organization or agent |
| GET | `/api/v1/payment-policies` | organization or agent |
| POST | `/api/v1/payment-intents` | `payment:create` |
| GET | `/api/v1/payment-intents` | organization / owning agent |
| GET | `/api/v1/payment-intents/:id` | organization / owning agent |
| POST | `/api/v1/payment-intents/:id/quote` | `payment:quote` |
| POST | `/api/v1/payment-intents/:id/select` | `payment:authorize` |
| POST | `/api/v1/payment-intents/:id/authorize` | `payment:authorize` |
| POST | `/api/v1/payment-intents/:id/simulate` | `payment:authorize` |

Create accepts `instruction` (e.g. `"Pay 500 USD to merchant X"`) and/or structured fields, plus
`Idempotency-Key`. Same key and payload replay the original intent; a different payload is
`409 IDEMPOTENCY_CONFLICT`. Selecting a route after `quoteExpiresAt` (or the selected option's own
expiry) is `409 QUOTE_EXPIRED` with `requoteRequired: true` — the agent must quote again rather than
proceed on stale pricing. Policy denials are `403 POLICY_DENIED` (distinct from `VALIDATION_ERROR`
and `FORBIDDEN`).

The policy engine evaluates, fail-closed:

- maximum transaction amount
- daily transaction limit
- allowed assets
- allowed chains (empty denies on-chain routes; fiat `chainId: null` is still allowed)
- allowed providers (empty means none)
- allowed countries (`*` means any; empty means none)
- allowed recipients (empty means none)
- maximum fees
- minimum route score (missing score denies)
- minimum liquidity (unknown headroom denies when the minimum is greater than 0)
- maximum slippage (missing slippage denies)
- preferred route preference (when set: ranking input to MultiRailRouter, and select must use the recommended route)
- verified mandate scope (`mandate_scope`), when `MANDATE_INGESTION_ENABLED` is on and the agent has
  verified, unexpired mandates. Intersection is fail-closed: empty allowlists deny.

Every decision writes `payment.policy.evaluated` (`allowed`, `aiUsed: false`, `failClosed: true`).
Denials also write `payment.policy.denied`. The engine runs at intent create, quote, select,
authorize, simulate, and immediately before an execution intent is recorded. Select/authorize/simulate
check-and-reserve daily spend atomically (in-flight `ROUTED` counts toward the cap). Evaluation
errors fail closed.

Quoted routes snapshot `routeScore`, `slippageBps`, `liquidityHeadroom`, `chainId`, and
`jurisdictions` from the routing engine. The router itself is unchanged.

Simulate sets `SIMULATION_COMPLETED` with `simulated: true` and `fundsMoved: false`. It does not call a real
provider. `POST /api/v1/executions` is still 501.

## Signed mandate ingestion

Agents present a signed authorization (how much, which corridor / currencies / beneficiaries).
Meridian **verifies and stores** it. Money does not move. Private keys are not generated or held
on the request path. HTTP is fail-closed behind `MANDATE_INGESTION_ENABLED` (default `false`) →
`403 FORBIDDEN` `ingestion_disabled`. Responses carry `sandbox: true`.

| Method | Path | Scope |
| ------ | ---- | ----- |
| POST | `/api/v1/mandates/verify` | `mag_` `mandate:verify` |
| GET | `/api/v1/mandates/:id` | organization; agents only see their own (else 404) |
| POST | `/api/v1/mandates/:id/revoke` | owner/admin `mandate:revoke` |

Formats:

- **AP2** Intent Mandate and Cart Mandate — W3C Verifiable Credential, ECDSA P-256 + SHA-256 over
  canonical JSON of the credential without `proof`.
- **x402** — first `POST` with `{ "format": "x402", "scope": { … } }` returns `402 X402_PAYMENT_REQUIRED`
  and a challenge. Retry with `challengeId` and `authorization: { publicKeyJwk, signature }` over
  canonical `{ challengeId, nonce, organizationId, agentId, scope }`. The 402 is not audited as
  `mandate.rejected`.
- **MPP** — session mandate that locks a spend cap for later batched consumption. Consumption is
  not performed; `POST /executions` remains 501.

A verified mandate is bound to the presenting organization and `mag_` agent (`mdt_…`). The spend
cap is a **limit**, not a balance. Wrong-tenant ids are `404`, never `403`. Audit:
`mandate.verified`, `mandate.rejected`, `mandate.revoked`.

## Execution-partner adapters

Meridian forwards a **caller-signed** instruction to a sandbox execution partner. The partner
settles to the beneficiary. Meridian does not hold funds or keys. `POST /api/v1/executions`
remains 501. Live adapters are behind `PARTNER_LIVE_ENABLED` (default `false`) and are not
implemented.

| Method | Path | Auth |
| ------ | ---- | ---- |
| GET | `/api/v1/execution-partners` | public catalog of mock capabilities |
| POST | `/api/v1/partner-instructions` | organization |
| GET | `/api/v1/partner-instructions/:id` | organization; wrong tenant 404 |
| POST | `/api/v1/partner-webhooks/:partnerId` | sandbox mock callback |

Responses carry `sandbox: true`, `fundsMoved: false`, `meridianKeysUsed: false`. Status walks
`accepted → settling → settled` (or `partial` / `failed`). Audit: `partner.dispatched`,
`partner.status_changed`, `partner.failed` (hashes only; no PII, no raw signature).

`POST /comparisons`, `POST /routes`, and `POST /quote` accept optional `mandateId`. Out-of-scope
routes are dropped after ranking; an empty set is `422 NO_ROUTES_AVAILABLE`. Anonymous callers
cannot attach a mandate (`401`).

## AI agent natural-language routing

The AI-facing layer. An LLM or agent may only interpret language; the deterministic routing engine
prices the corridor.

| Method | Path | Scope |
| ------ | ---- | ----- |
| POST | `/api/v1/agent/interpret` | `payment:create` |
| POST | `/api/v1/agent/route` | `payment:create`, `payment:quote`, `payment:authorize` |

```json
{ "instruction": "Pay 1,000 USD to this merchant using the cheapest compliant route." }
```

`interpret` returns a structured intent (`optimizationPreference`: `LOWEST_COST` | `FASTEST` |
`BALANCED` | `LOWEST_SLIPPAGE` | `HIGH_LIQUIDITY`) with `interpreter: "deterministic_parser"`,
`aiUsed: false`, and `didNotCompute: ["exchange_rates", "fees", "slippage", "settlement_amounts"]`.

`route` runs parser → policy → routing engine → provider quotes → selects the recommended route →
gates the selected route through the policy engine again → records an execution intent
(`status: recorded`, `executable: false`). It does not pay. `Idempotency-Key` is honoured on create.
Policy denials are `403 POLICY_DENIED`.

## `GET /api/v1/dashboard/settings`

Members and API key prefixes for this organization. Another tenant's rows are never selected. A
foreign id is `404 NOT_FOUND`.

## `POST /api/v1/executions`

When `EXECUTION_ENABLED` is false (the default), this route always returns `501 EXECUTION_NOT_IMPLEMENTED` and audits `execution.rejected`. Anonymous callers receive the same 501.

When the flag is true in **sandbox** mode, `POST` creates an orchestration from a verified mandate and a selected multi-rail route:

`CREATED → ROUTED → COMPLIANCE_PASSED → mandate recheck → daily-limit reserve → DISPATCHED → SETTLING → SETTLED | FAILED`

Quote expiry becomes `EXPIRED`. Compliance deny or mandate/policy/limit failure becomes `BLOCKED`. Compliance `review` parks at `COMPLIANCE_REVIEW`. Each transition is audited and the `Idempotency-Key` is honoured (same payload replays; different payload is `409`).

Meridian HMAC-signs the **instruction envelope** with a vault partner-scoped credential (`instruction_hmac`). It does not sign a funds transfer. Responses carry `sandbox: true`, `fundsMoved: false`, `custody: false`, `transferSigned: false`, `meridianKeysUsed: false`. Mock partners simulate settlement. Success records take-rate / partner-commission attribution (`realizedRevenue` stays false).

`GET /api/v1/executions/:id` is organization-scoped (wrong tenant `404`). Live partners are never called. `delegateExecution` and `executeTransactions` stay false. Production-locked processes cannot enable the flag.

## `GET /api/v1/executions/:id/receipt`

Issued after a sandbox orchestration reaches `SETTLED`. The body is an Ed25519 signature over canonical JSON of:

- mandate reference (id, issuer, agent, payload/scope hashes, spend-cap limit, corridors — **not** raw beneficiaries)
- selected route and best-execution rationale (deterministic `routeExplanation`)
- partner settlement confirmation hashes (`instructionHash`, `signatureHash`, partner status, filled amount)
- timestamps (`quotedAt`, `quoteExpiresAt`, `createdAt`, `dispatchedAt`, `settledAt`)

`fundsMoved`, `custody`, `transferSigned`, and `meridianKeysUsed` are always false. The signing **private** key lives in the vault (`meridian-receipt-signer` / `receipt_ed25519`) and is never exported. The **public** key is on `receipt.verification.publicKeyPem`.

### Independent verification

1. Canonicalize `receipt.payload` with sorted-key JSON (`canonical-json`, same as comparison fingerprints).
2. SHA-256 the canonical UTF-8 bytes; it must match `receipt.payloadHash`.
3. Decode `receipt.signature` as base64url.
4. Verify Ed25519 over the canonical bytes with `receipt.verification.publicKeyPem`.
5. Confirm the non-custodial flags are false.

`POST /api/v1/receipts/verify` runs the same check on a presented `{ payload, signature, publicKeyPem }` without looking up tenant data. Flipping one bit of the signature or payload fails verification.

## `GET /api/v1/reconciliation/mismatches`

Organization-scoped. Requires `EXECUTION_ENABLED`. Matches dispatched instruction ↔ partner confirmation ↔ fee attribution and returns flagged disagreements (`instruction_hash_mismatch`, `amount_mismatch`, `filled_amount_mismatch`, `partner_status_mismatch`, `missing_partner_confirmation`, `missing_fee_attribution`, `fee_tpv_mismatch`, `non_custodial_violation`). This does not move funds.

## `GET /api/v1/audit/export`

Owner/admin human session only. Exports this tenant's audit events (`organization_id` from the principal, never from the query). Agents and organization API keys are `403`. Another tenant's rows are never selected. Optional `limit`, `from`, `to` query parameters.
