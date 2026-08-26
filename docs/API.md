# Meridian API

Base URL in local development: `http://127.0.0.1:47311`

Every quote this API returns is **indicative and non-binding**. Meridian does not custody funds or
execute transactions; see [COMPLIANCE.md](./COMPLIANCE.md).

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

| Code                                  | Status    | Meaning                                                                             |
| ------------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`                    | 400       | Request failed schema or amount validation.                                         |
| `UNSUPPORTED_CURRENCY`                | 400       | Currency is outside the supported set.                                              |
| `UNSUPPORTED_CORRIDOR`                | 422       | No registered provider prices this corridor.                                        |
| `NO_ROUTES_AVAILABLE`                 | 422       | Providers were eligible but none returned a usable quote.                           |
| `NOT_FOUND`                           | 404       | Unknown comparison, or unknown route.                                               |
| `IDEMPOTENCY_CONFLICT`                | 409       | Idempotency key reused with a different payload.                                    |
| `EXECUTION_NOT_IMPLEMENTED`           | 501       | Deliberate refusal to move money.                                                   |
| `PROVIDER_TIMEOUT` / `PROVIDER_ERROR` | 504 / 502 | Upstream provider failed. Usually reported per-route in `providerFailures` instead. |
| `INTERNAL_ERROR`                      | 500       | Unexpected defect. Details are never leaked.                                        |

**Money.** Amounts always serialise with the integer minor units as the authoritative value:

```json
{ "currency": "KRW", "minorUnits": "138071533", "decimal": "138071533", "exponent": 0 }
```

Parse `minorUnits`, not `decimal`. Rates, basis points and percentages are exact decimal strings
for the same reason — never JSON numbers.

**Headers.**

| Header             | Direction | Purpose                                                                              |
| ------------------ | --------- | ------------------------------------------------------------------------------------ |
| `Idempotency-Key`  | request   | 8–128 chars. Replays return the original comparison.                                 |
| `X-Meridian-Actor` | request   | Attribution for the audit trail. Phase 2 replaces it with an authenticated identity. |
| `X-Request-Id`     | response  | Correlates a response with its log and audit entries.                                |

---

## `GET /health`

Liveness. Returns `status`, `mode`, `engineVersion`, `uptimeSeconds`. No envelope.

## `GET /ready`

Readiness: verifies the persistence store is reachable and its schema present. `200` when ready,
`503` otherwise. Keep this separate from `/health` so a database blip does not get a healthy
process restarted.

## `GET /v1/meta`

Everything a client needs to build a request: platform mode, engine version, declared capabilities,
pricing dataset versions, registered providers, rails (with `available` / `planned` status),
supported currencies with their minor-unit exponents, and the default scoring weights.

The `capabilities` block is the machine-readable form of the compliance boundary:

```json
{
  "compareRoutes": true,
  "executeTransactions": false,
  "custodyFunds": false,
  "holdCryptoAssets": false,
  "issueStablecoins": false
}
```

## `POST /v1/comparisons`

Compares every eligible route for a transaction.

```jsonc
{
  "sourceCurrency": "USD",
  "targetCurrency": "KRW",
  "amount": "100000.00", // major units, no more precision than the currency allows
  "rails": ["bank_fx"], // optional; omit for every rail
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

## `GET /v1/comparisons/:comparisonId`

Returns the stored comparison **verbatim**, exactly as it was quoted. Re-reading a comparison shows
the prices as they were, not as they are now — which is the point of persisting it.

## `GET /v1/comparisons?limit=20`

Summaries of recent comparisons, newest first.

## `POST /v1/comparisons/:comparisonId/replay`

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

## `GET /v1/comparisons/:comparisonId/audit`

The append-only audit trail for one comparison: `comparison.requested`, one
`provider.quote.received` or `provider.quote.failed` per provider, `comparison.completed`, and any
`comparison.replayed` events.

## `POST /v1/executions`

Always returns `501 EXECUTION_NOT_IMPLEMENTED`, and audits the attempt.

This endpoint exists so the refusal to move money is visible in the API surface, recorded when
someone tries, and covered by a test — rather than being an absent route that answers 404 and
explains nothing. Nothing in the codebase can initiate a payment.
