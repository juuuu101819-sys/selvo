# Meridian — Quote Engine

The mathematics of pricing and ranking a route, stated precisely enough to reimplement or audit.

Engine version **2.0.0**. The version covers calculation _semantics_: any change that would alter the
output for an unchanged input bumps it, and it is recorded on every stored comparison so a replay
across a change is detectable rather than silently different.

---

## Contract

**Input**

```jsonc
{
  "organizationId": "org_...", // determines which negotiated terms apply
  "sourceCurrency": "USD",
  "targetCurrency": "KRW", // `destinationCurrency` accepted as a synonym
  "amount": "100000.00", // major units; converted to exact minor units
}
```

**Output** — ranked routes, best first, plus the recommendation:

```jsonc
{
  "routes": [
    {
      "provider": { "id": "...", "name": "...", "rail": "stablecoin_settlement" },
      "exchangeRate": "...",
      "midMarketRate": "...",
      "effectiveRate": "...",
      "spreadBps": "10",
      "slippageBps": "4",
      "totalCost": { "minorUnits": "470467", "currency": "KRW" },
      "estimatedReceiveAmount": { "minorUnits": "138071533", "currency": "KRW" },
      "settlement": { "p50Seconds": 300, "p95Seconds": 1800 },
      "breakdown": { "...": "every component, reconciling exactly to totalCost" },
      "score": "97.42",
      "scoreComponents": {
        "cost": "...",
        "speed": "...",
        "reliability": "...",
        "slippage": "...",
        "liquidity": "...",
        "risk": "...",
      },
    },
  ],
  "recommendedRouteId": "...",
}
```

## Notation

| Symbol                             | Meaning                                | Representation                             |
| ---------------------------------- | -------------------------------------- | ------------------------------------------ |
| $S$                                | Send amount                            | integer minor units of the source currency |
| $M$                                | Mid-market rate                        | exact decimal, 34 significant digits       |
| $O_q$                              | Rate the provider quoted               | exact decimal                              |
| $O$                                | Rate after any negotiated discount     | exact decimal                              |
| $E$                                | Rate after slippage                    | exact decimal                              |
| $F^{prov}_{src}$, $F^{plat}_{src}$ | Provider and platform source-side fees | minor units, source                        |
| $F_{dst}$                          | Destination-side fees                  | minor units, destination                   |
| $A$                                | Amount actually converted              | minor units, source                        |
| $G$                                | Gross converted amount                 | minor units, destination                   |
| $D$                                | Delivered (estimated receive) amount   | minor units, destination                   |
| $B$                                | Mid-market benchmark                   | minor units, destination                   |
| $T$                                | Total cost                             | minor units, destination                   |

No step uses binary floating point. Amounts are `bigint` counts of minor units; rates and ratios are
`decimal.js` at 34 significant digits. Every conversion out of the exact decimal domain names its
rounding mode.

## 1. Cost

### 1.1 Benchmark

$$B = \lfloor S \times M \rfloor$$

Rounded **down**, so a payout is never over-promised.

Cost is measured against mid-market, not against each provider's own rate. This is the single most
important decision in the model: a bank quoting "no fees" on a 69 bps spread must not appear cheaper
than a payment institution charging an explicit fee on a near-mid rate. Anchoring on the provider's
own rate would report every route as costing nothing.

If $B = 0$ the request is rejected — an amount too small to produce one minor unit at mid-market
cannot be priced meaningfully.

### 1.2 Negotiated discount

The quoted spread, in basis points:

$$\sigma_q = \frac{M - O_q}{M} \times 10^4$$

A customer-specific discount $\delta \ge 0$ narrows it:

$$\sigma = \sigma_q - \delta, \qquad O = M \times \left(1 - \frac{\sigma}{10^4}\right)$$

A discount can only improve a rate. A provider quoting _above_ mid ($\sigma_q < 0$, which happens on
keenly priced corridors) keeps that advantage and the discount is added on top, rather than being
clamped away at zero. $O \le 0$ is rejected.

There is deliberately no floor at $\sigma = 0$: a discount larger than the quoted spread takes the
customer **through** mid-market, the total cost goes negative, and the difference is funded by the
platform. That is a subsidy — a legitimate commercial promotion, but one that shows up as negative
platform take, so it is pinned by a test and must never be configured by accident. An account
manager who wants "free, at cost" sets the discount equal to the spread, not above it.

### 1.3 Fees

Fixed fees are taken as stated. Proportional fees are applied to the amount on their own side of the
transfer, then bounded by any floor or cap:

$$f_i = \mathrm{clamp}\left(\left\lceil \text{base}_i \times \frac{r_i}{10^4} \right\rfloor_{\text{half-up}},\ \text{floor}_i,\ \text{cap}_i\right)$$

The platform's own charge is a **markup** $\mu$ on the notional plus an optional flat fee $\phi$:

$$F^{plat}_{src} = \left\lceil S \times \frac{\mu}{10^4} \right\rfloor_{\text{half-up}} + \phi$$

Rounded **half up** — against the customer — for every charge, consistently, so no route benefits
from a rounding convention.

The platform's take is modelled as an explicit fee, never folded into the rate. A platform taking its
margin inside the spread would be doing exactly what this product exists to expose in other people's
pricing.

A flat fee quoted in the destination currency is valued at **mid-market**; converting it at the
provider's offered rate would hide a second spread inside the platform's own fee.

### 1.4 Conversion

$$A = S - F^{prov}_{src} - F^{plat}_{src}$$

$A \le 0$ is rejected: fees at or above the notional leave nothing to convert.

Expected slippage $\varsigma$ in basis points is read from the provider's tiered model at the request
notional — the first tier whose inclusive threshold covers it:

$$E = O \times \left(1 - \frac{\varsigma}{10^4}\right)$$

$$G = \lfloor A \times E \rfloor, \qquad D = G - F_{dst}$$

Both conversions round **down**. $\varsigma \ge 10^4$ is rejected as it would consume the notional.

### 1.5 Total cost

$$T = B - D, \qquad T_{bps} = \frac{T}{B} \times 10^4$$

$$R_{\text{effective}} = \frac{D}{S}$$

## 2. Attribution

The breakdown is a decomposition, not an estimate. All components are valued in the destination
currency:

$$
\begin{aligned}
C_{prov} &= \lceil F^{prov}_{src} \times M \rfloor & \text{(provider fees at mid)} \\
C_{plat} &= \lceil F^{plat}_{src} \times M \rfloor & \text{(platform fees at mid)} \\
C_{spread} &= \lceil A \times (M - O) \rfloor & \text{(FX spread, after discount)} \\
C_{slip} &= \lceil A \times (O - E) \rfloor & \text{(expected slippage)} \\
C_{dst} &= F_{dst} & \text{(destination fees)}
\end{aligned}
$$

In exact arithmetic these sum to $T$:

$$M(F^{prov}_{src} + F^{plat}_{src}) + A(M - O) + A(O - E) + F_{dst} = MS - AE + F_{dst} = B - D = T$$

Each is independently rounded to minor units, so a sub-unit residue can remain. It is carried in
`roundingAdjustment`, which keeps the breakdown a true decomposition rather than an approximation —
and is asserted by tests at both the engine and HTTP layers.

Provider and platform charges are reported **separately**. Netting them would make the platform's
margin unauditable, and a customer disputing a number is entitled to know who took it.

## 3. Commercial terms

Terms are overlapping rules resolved by priority, not one rate per customer, because real B2B pricing
is negotiated per corridor and per rail. Selection is pure and total — the same rule set and criteria
always select the same rule, on any machine:

1. **Priority**, descending — the explicit lever an account manager sets.
2. **Specificity**, descending — a corridor-specific term beats a blanket one at equal priority.
   Without this, whichever row happened to sort first would win, which is not a decision anybody made.
3. **Most recently effective**, descending.
4. **Rule id**, ascending — a final tiebreak, so the result never depends on database row order.

Only rules whose effective window contains the _quote's_ instant are considered. A repricing is an
insert, not an update, so a historical quote can always be explained by the terms that applied when it
was issued.

## 4. Scoring

Each factor is normalised to $[0, 1]$ where 1 is best, then weighted:

$$\text{score} = 100 \times \sum_{k} w_k \cdot n_k, \qquad \sum_k w_k = 1$$

Weights must sum to exactly 1. A set summing to 0.9 would silently compress every score; one summing
to 1.1 would let a route exceed 100.

### 4.1 Relative factors

Cost, speed and slippage are min–max normalised across the candidate set:

$$n_k = \frac{\max_k - x}{\max_k - \min_k}$$

The question a user asks is "which of these is best", not "is this good in the abstract" — a corridor
where every route costs 200 bps should still produce a clear winner. Speed uses the median (p50)
settlement time, matching the figure shown in the UI.

**Degenerate case.** When every candidate ties, the span is zero and there is no meaningful ordering.
Every route receives the neutral value 1 rather than a division by zero, so the remaining weighted
factors decide the ranking. This is what makes a set of identical quotes rank deterministically.

### 4.2 Absolute factors

Reliability and risk arrive on their own $[0,1]$ scales and are used directly. Min–max normalising
reliability would make three highly reliable providers look as though one were unreliable — worse than
useless, because it would actively mislead.

**Risk** compounds two signals so a serious concern on either cannot be averaged away by a clean score
on the other:

$$n_{risk} = \mathrm{clamp}_{[0,1]}\left( J \times \left(1 - \frac{\text{settlementRiskBps}}{10^4}\right) \right)$$

$$J = \begin{cases} 1.0 & \text{low} \\ 0.85 & \text{medium} \\ 0.6 & \text{high} \end{cases}$$

A provider supplying no risk signals scores the neutral 0.75. Penalising silence would rank an
unmeasured provider below a measured mediocre one, which the platform has no evidence for.

**Liquidity** scores disclosed depth against the order, absolutely rather than relatively — cover is a
question about the order, not about the other providers:

$$n_{liq} = \mathrm{clamp}_{[0,1]}\!\left(\frac{\text{depth}}{2S}\right)$$

Two times cover is full marks: a provider that can only just fill the order is a real execution risk
even though it technically can. Where a rail publishes no depth — the norm for bank FX and payout
networks, which have no order book — the factor scores 1. Absent depth means "not a constraint", and
marking down an entire class of provider for a concept that does not apply to them would be wrong.

### 4.3 Default weights

| Factor      | Weight |
| ----------- | ------ |
| cost        | 0.45   |
| speed       | 0.25   |
| reliability | 0.10   |
| slippage    | 0.08   |
| liquidity   | 0.05   |
| risk        | 0.07   |

Cost dominates because it is what a treasury team is optimising and the only factor measured in money.
Speed is next, because a settlement delay has a real financing cost. The remaining four are
deliberately small: they break ties between routes that are close on cost and speed, which is where
they belong, rather than overriding a materially cheaper route on a soft signal.

Overridable per request, and via `ROUTE_WEIGHT_*` environment variables whose defaults are taken from
the engine so the two cannot drift. The three factors added in 2.0.0 default to zero when omitted, so
a weight set written against the earlier three-factor engine still sums to 1 and still means what it
did.

### 4.4 Ranking

A total order, so the result never depends on the order provider responses arrived in:

1. score, descending
2. total cost in basis points, ascending
3. median settlement time, ascending
4. route id, ascending

## 5. Determinism

No AI, no heuristics, no randomness, no clock and no I/O anywhere on the calculation path. The engine
is a pure function of `(request, quote, provider descriptor, commercial terms)`.

This is enforced rather than intended:

- ESLint forbids `Math.random`, `Math.round`, float parsing and direct clock reads in `packages/core`.
- The clock is an injected port, so timestamps are controllable.
- Every comparison persists a snapshot — the request, the raw provider quotes, the provider
  descriptors, the scoring weights and the commercial terms in force — plus a SHA-256 fingerprint over
  its canonical form. Canonical JSON sorts keys and rejects fractional numbers, so the hash is stable
  across machines and Node versions.
- `POST /api/v1/comparisons/:id/replay` re-derives the result from the snapshot and reports whether it
  reproduced.

**Engine version and replay.** A snapshot made by a different engine version can hash identically
while producing different numbers, because the fingerprint covers the inputs and the engine's declared
version but not its arithmetic. Replay therefore compares both, and reports
`divergence: "engine_version_changed"` rather than claiming reproducibility it cannot demonstrate.
Reporting that as reproducible would be the most misleading answer available.

## 6. Edge cases

| Case                                  | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zero or negative amount               | Rejected, `400 VALIDATION_ERROR`.                                                                                                                                                                                                                                                                                                                                                                                               |
| Amount above the deployment ceiling   | Rejected with the configured maximum named.                                                                                                                                                                                                                                                                                                                                                                                     |
| Very large amount                     | Priced exactly. Amounts are `bigint` minor units, so an IDR-scale notional past $2^{53}$ neither overflows nor loses digits, and cost in basis points stays scale-invariant.                                                                                                                                                                                                                                                    |
| Amount below every provider's minimum | `422 UNSUPPORTED_CORRIDOR`, naming the amount and the possible causes rather than blaming the corridor.                                                                                                                                                                                                                                                                                                                         |
| Unsupported currency                  | Rejected at the schema; an unrecognised code from a provider raises `INVALID_PROVIDER_QUOTE`.                                                                                                                                                                                                                                                                                                                                   |
| Provider unavailable                  | That route is dropped and reported in `providerFailures`; the comparison still returns. One dead bank does not fail the request.                                                                                                                                                                                                                                                                                                |
| Every provider unavailable            | `422 NO_ROUTES_AVAILABLE` with the failures listed.                                                                                                                                                                                                                                                                                                                                                                             |
| Expired quote                         | Rejected **at ingestion**: a quote already past its expiry when the fan-out returns becomes a `QUOTE_EXPIRED` provider failure, evidenced in the audit trail as received and then rejected. A stale or clock-skewed quote fails the same way with its own code. The check never runs on the replay path — a replay prices quotes weeks past their expiry by design. See [PROVIDERS.md](./PROVIDERS.md) for the freshness model. |
| Identical provider quotes             | Identical scores, ranked in a stable deterministic order by route id, with exactly one recommendation.                                                                                                                                                                                                                                                                                                                          |
| Extremely high spread                 | Priced and ranked last, not discarded — the customer is entitled to see what they were offered. Only a spread leaving nothing to deliver is rejected.                                                                                                                                                                                                                                                                           |
| Fees at or above the notional         | Rejected for that route, naming the provider and platform components separately.                                                                                                                                                                                                                                                                                                                                                |

## 7. Where the code is

| Concern               | File                                             |
| --------------------- | ------------------------------------------------ |
| Cost model            | `packages/core/src/engine/cost-engine.ts`        |
| Commercial terms      | `packages/core/src/engine/platform-pricing.ts`   |
| Scoring and ranking   | `packages/core/src/engine/route-scorer.ts`       |
| Weights and constants | `packages/core/src/engine/engine-config.ts`      |
| Orchestration         | `packages/core/src/engine/comparison-service.ts` |
| Money and rates       | `packages/core/src/money/`                       |
| Fingerprinting        | `packages/core/src/reproducibility/`             |

Tests: `quote-engine.test.ts` (edge cases, platform fee arithmetic, determinism),
`cost-engine.test.ts` (cost model), `route-scorer.test.ts` (scoring), `platform-pricing.test.ts`
(rule resolution), `apps/api/src/routes/quote-engine.test.ts` (over HTTP).

---

## Multi-rail routing engine (version 1.0.0)

Independent of the comparison engine above. Do not bump `ENGINE_VERSION` when this engine changes.

**Input**

```jsonc
{
  "sourceAsset": "USD",
  "destinationAsset": "KRW",
  "amount": "100000.00",
  "organizationId": "org_...", // from the principal, never the body
  "preferences": { "weights": { "cost": "0.45", "speed": "0.20", "liquidity": "0.15", "reliability": "0.10", "settlementConfidence": "0.10" } }
}
```

**Cost** uses the same identity as §1, expressed in assets rather than ISO currencies:

$$B = \lfloor S \times M \rfloor,\quad
D = \lfloor ((S - F_{src} - F_{plat}) \times O \times (1 - s)) \rfloor - F_{dst},\quad
T = B - D$$

Network and gas fees are fee lines (`code` contains `network` or `gas`), not a second cost model.

**Score** (defaults sum to 1):

| Factor                 | Weight | Normalisation                                      |
| ---------------------- | ------ | -------------------------------------------------- |
| Cost                   | 45%    | min-max, lower is better                           |
| Speed                  | 20%    | min-max on p50 seconds, lower is better            |
| Liquidity              | 15%    | absolute; undisclosed depth scores as unconstrained |
| Reliability            | 10%    | provider `0..1`                                    |
| Settlement confidence  | 10%    | `tightness × cutoffFactor × calendarFactor`        |

Settlement confidence is **not** speed. Tightness is `clamp(1 − (p95 − p50) / 2 days)`. A cutoff
raises confidence; business-days-only lowers it.

No rail family is assumed cheaper. Ranking is score, then cost, then p50, then route id.

`routeExplanation` is a template over those components. **No model computes a price or a score.**

Route D (fiat → stablecoin → DEX → fiat) is listed under `plannedRoutes` and is not composed.

The **financial route graph** (`packages/core/src/graph`, `graphEngineVersion` 1.0.0) is a separate
discovery engine. It walks indicative conversion edges; it does not replace this scoring mathematics
and it does not submit a conversion.

| Concern                 | File                                               |
| ----------------------- | -------------------------------------------------- |
| Asset amounts           | `packages/core/src/money/asset-amount.ts`          |
| Routing cost            | `packages/core/src/engine/routing-cost.ts`         |
| Routing score           | `packages/core/src/engine/routing-scorer.ts`       |
| Explanation             | `packages/core/src/engine/routing-explanation.ts`  |
| Orchestration           | `packages/core/src/engine/routing-engine.ts`       |
| Route graph             | `packages/core/src/graph/`                         |
| HTTP                    | `apps/api/src/routes/routing.ts`                   |
