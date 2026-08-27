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
| `IDEMPOTENCY_CONFLICT`                | 409       | Idempotency key reused with a different payload.                                             |
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

**Authentication.** Public comparison, meta and health stay available without a credential. Presenting
`Authorization: Bearer mds_…` or `X-Api-Key` authenticates a user or service principal whose
`organizationId` scopes every dashboard query. A credential that cannot be verified is `401
UNAUTHENTICATED`, never silently treated as anonymous. `GET /api/v1/meta` reports the active scheme
under `authentication` (`session+api_key`, `enforcing: true`).

Demo sandbox login: `treasury@demo-trading.example.invalid` / `MeridianDemo!2026`. Sessions last
12 hours. Dashboard settings return API key **prefixes** only.

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
  "agentPayments": false,
  "defiQuotes": true,
  "defiExecution": false
}
```

`execution.delegated` is false. `pipeline` names Discover → Delegate; only `delegate` is `planned`.
`railFamilies` lists `tradfi` and `stablecoin` as available and `defi` as planned for the
comparison engine. `providerCatalog` lists every `FinancialProvider`, including read-only DeFi
demos that are not in `providers`. `defiQuotes` is true; `defiExecution` is false.

## `GET /api/v1/providers`

The multi-rail catalog: wrapped comparison rails plus demo ramp, AMM and aggregator. Each row has
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

## `POST /api/v1/comparisons`

Compares every eligible route for a transaction.

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
  a full `breakdown`, a `score` and its `scoreComponents`.
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

## `GET /api/v1/dashboard/quotes`

## `GET /api/v1/dashboard/quotes/:id`

## `GET /api/v1/dashboard/transactions`

## `GET /api/v1/dashboard/transactions/:id`

## `GET /api/v1/dashboard/providers`

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
