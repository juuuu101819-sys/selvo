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
| `Authorization` / `X-Api-Key` | request   | Session bearer (`mds_…`) or organization API key. Unverifiable credentials are `401`.      |
| `X-Request-Id`                | response  | Correlates a response with its log and audit entries.                                      |
| `Deprecation` / `Link`        | response  | Present on the legacy `/v1` prefix only.                                                   |

**Authentication.** Public comparison, meta, health, provider catalog, assets and currencies stay
available without a credential. Presenting `Authorization: Bearer mds_…` or `X-Api-Key` authenticates
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
12 hours. Dashboard settings return API key **prefixes** only.

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
with their minor-unit exponents, and the default scoring weights.

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
  "agentFinancialDashboard": true
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
settlement amounts. `paymentPolicyEngine` is true: every agent request is evaluated fail-closed
before quotes, authorization, simulation, and execution-intent recording. `multiRailMonetization`
is true: quoted TPV, platform revenue, provider cost, partner commission, gross profit and take
rate are attributed on the revenue dashboard. `agentFinancialDashboard` is true: organization
operators can inspect agent volume, fees, success rate, spending limits and policy denials, and
patch allow-lists. The dashboard never custodies funds, holds keys, or generates wallets.
`POST /api/v1/executions` remains 501.

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

Multi-rail routing engine. Evaluates Traditional Finance, stablecoin and DeFi quotes with one
deterministic scorer. `POST /comparisons` uses this same MultiRailRouter (`routingEngineVersion`
**1.0.0**). The fiat library constant `ENGINE_VERSION` **2.0.0** remains on `GET /meta` and is not
the comparison ranking engine. No model is used for any figure.

```jsonc
{
  "sourceAsset": "USD",
  "destinationAsset": "KRW", // `targetAsset` accepted as a synonym
  "amount": "100000.00",
  "preferences": {
    "weights": {
      // optional; must sum to exactly 1
      "cost": "0.45",
      "speed": "0.20",
      "liquidity": "0.15",
      "reliability": "0.10",
      "settlementConfidence": "0.10"
    }
  }
}
```

`organizationId` is taken from the authenticated principal, never the body. The schema is strict:
`execute`, keys and beneficiary fields are rejected.

Returns `201` with:

- `routes[]` — ranked best-first, each with hops, economics, score components and `routeExplanation`
- `recommendedRoute` — the rank-1 route
- `routeScore`, `estimatedCost`, `estimatedReceiveAmount`, `estimatedSettlementTime`,
  `routeExplanation` — echoed from the recommendation
- `plannedRoutes` — Route D (fiat → stablecoin → DEX → fiat) is declared, not composed
- `aiUsed: false`
- `monetization` — quoted economics for the recommended route (`ROUTE_QUOTE`): provider cost,
  platform fee, partner commission, gross margin, take rate, TPV basis. `realizedRevenue` is
  always `false`. Discovery does not create realized revenue.

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
`POST /routes`, `engineVersion` **1.0.0**). `RouteComparisonService` is not on this path.

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

Summaries of recent comparisons, newest first.

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

## `POST /api/v1/auth/logout`

Revokes the session presented in `Authorization`. Idempotent for anonymous callers.

## `GET /api/v1/auth/me`

The verified principal's user, organization and role. `401` without a credential.

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
rate. Breakdowns: rail, provider, currency, asset, organization, AI agent, transaction type, revenue
source, date. Includes the canonical $100,000 worked example.

Anonymous callers are `401`. Another tenant's events never appear.

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
multi-rail engine (`routingEngineVersion` 1.0.0) and returns a slim DTO. Optional `organizationId`
in the body is a claim that must match the principal — it is never the source of truth.

```jsonc
{
  "sourceAsset": "USD",
  "destinationAsset": "KRW",
  "amount": "100000.00",
  "organizationId": "org_...",
  "preferences": {
    "weights": {
      "cost": "0.45",
      "speed": "0.2",
      "liquidity": "0.15",
      "reliability": "0.1",
      "settlementConfidence": "0.1"
    }
  }
}
```

```jsonc
{
  "requestId": "req_...",
  "routes": [ { "routeId": "...", "executable": false } ],
  "recommendedRoute": { "routeId": "..." },
  "quoteExpiresAt": "2026-03-01T09:15:00.000Z"
}
```

Anonymous callers are `401`. A mismatched `organizationId` is `403`. Missing `quote:read` is `403`.
`POST /api/v1/routes` remains the public (unscoped) multi-rail endpoint.

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

Requires `transaction:create` (organization API keys minted with that scope — never human sessions).
Records a route choice with `status: "recorded"`, `executable: false`, `submitted: false`. This is
not a payment. An expired `quoteExpiresAt` is rejected with `409 QUOTE_EXPIRED` (`requoteRequired:
true`) and audited as `execution.intent.rejected` **before** Policy Engine evaluation. A payment
intent id that has already passed the Policy Engine (`ROUTED`, `POLICY_APPROVED`, `SIMULATION_PENDING`, or
`SIMULATION_COMPLETED`) is required; omitting it is `403 POLICY_DENIED` (`policy_required`). The gate
re-evaluates policy fail-closed immediately before persist. `POST /api/v1/executions` remains the
audited `501`.

## AI agent payments

Agents authenticate with `X-Api-Key: mag_...` (hashed, revocable). Human sessions never receive
`payment:*` scopes; only `mag_` credentials drive the agent payment API. Organization `mk_` keys do
not receive payment scopes by default.

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

Every decision writes `payment.policy.evaluated` (`allowed`, `aiUsed: false`, `failClosed: true`).
Denials also write `payment.policy.denied`. The engine runs at intent create, quote, select,
authorize, simulate, and immediately before an execution intent is recorded. Select/authorize/simulate
check-and-reserve daily spend atomically (in-flight `ROUTED` counts toward the cap). Evaluation
errors fail closed.

Quoted routes snapshot `routeScore`, `slippageBps`, `liquidityHeadroom`, `chainId`, and
`jurisdictions` from the routing engine. The router itself is unchanged.

Simulate sets `SIMULATION_COMPLETED` with `simulated: true` and `fundsMoved: false`. It does not call a real
provider. `POST /api/v1/executions` is still 501.

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

Always returns `501 EXECUTION_NOT_IMPLEMENTED`, and audits the attempt.

This endpoint exists so the refusal to move money is visible in the API surface, recorded when
someone tries, and covered by a test — rather than being an absent route that answers 404 and
explains nothing. Nothing in the codebase can initiate a payment, hold a key, or act as principal.
Delegated settlement (`delegateExecution`) is the future form of this endpoint and is not
implemented.
