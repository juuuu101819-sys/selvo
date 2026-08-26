# Meridian — Architecture

Meridian is a B2B **global financial routing** platform. It compares candidate routes for a
cross-border business transaction and reports the estimated all-in cost, exchange rate, fee
breakdown, settlement time, slippage and a composite route score.

Meridian is a **decision-support system**. It is explicitly not a money transmitter, not a
custodian, and not an execution venue. See [COMPLIANCE.md](./COMPLIANCE.md) for the hard
boundaries that the code enforces.

---

## 1. Design goals

| Goal                                  | How the architecture delivers it                                                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Providers are replaceable             | Every liquidity source sits behind the `RouteProvider` port. The engine never imports a concrete provider.                                                                               |
| No hardcoded quotes in business logic | Providers return _quote primitives_ (raw rates, fee schedules, slippage model parameters). Pricing data lives in versioned data files / external APIs, never in engine code.             |
| Decimal-safe arithmetic               | Monetary amounts are `bigint` minor units. Rates and ratios are `decimal.js` values with an explicit precision and rounding mode. No `number` arithmetic anywhere on the money path.     |
| Reproducible calculations             | Every comparison persists its full input snapshot (request + raw provider quotes + engine config) and a SHA-256 `fingerprint`. Replaying the snapshot must produce the same fingerprint. |
| Auditable                             | Financially meaningful events are written to an append-only audit log through the `AuditLogger` port.                                                                                    |
| Sandbox / production separation       | `PLATFORM_MODE` is a first-class, validated config value. Provider registration, response envelopes and the UI all branch on it.                                                         |

## 2. Bounded contexts and module map

```
apps/
  api/            HTTP boundary. Fastify + Zod. Owns validation, error mapping, wiring.
  web/            Next.js UI. Renders comparisons. Holds no financial logic.
packages/
  core/           Pure domain. Money, rates, cost engine, scorer, ports, errors.
                  Zero I/O. Zero framework imports. Zero provider knowledge.
  adapters/       Concrete RouteProvider implementations (sandbox rails today,
                  licensed partners later). Depends on core, never on api/web.
  persistence/    Repository implementations for the core persistence ports.
                  In-memory driver + PostgreSQL driver behind one interface.
```

The web app reaches the API through Next.js server actions rather than from the browser, so the
API's address stays server-side and no CORS grant is needed for the app's own traffic. It declares
its own copy of the wire contract instead of importing `core`, because it is a separate deployable
that should depend on the published API shape, not on the server's internals.

The dependency graph is strictly acyclic and points inward:

```
web ──▶ api ──▶ adapters ──┐
                persistence├──▶ core
                           ┘
```

`core` is the only package every other package depends on, and it depends on nothing but
`decimal.js`. That is what makes the financial logic unit-testable without a server, a
database or a network.

## 3. The money model

Two distinct numeric kinds, deliberately not interchangeable:

**`Money`** — an exact amount of a specific currency.

```ts
class Money {
  readonly currency: CurrencyCode; // "USD"
  readonly minorUnits: bigint; // 10_000_000n  == USD 100,000.00
}
```

Amounts are integers in the currency's minor unit, so they cannot drift. The exponent comes
from a currency registry (`USD` → 2, `KRW` → 0, `JPY` → 0, `BHD` → 3). Arithmetic between two
`Money` values of different currencies throws `CurrencyMismatchError` — the type system and the
runtime both refuse it.

**`Rate` / `Ratio`** — a dimensionless or cross-currency conversion factor, backed by
`decimal.js` configured with 34 significant digits. Rates are _never_ rounded to minor units;
only the result of applying a rate to a `Money` is.

**Rounding.** Every operation that leaves the exact decimal domain names its rounding mode.
The conventions, applied consistently so results never flatter a route:

- fees charged to the customer → `ROUND_HALF_UP` (round against the customer)
- amounts delivered to the beneficiary → `ROUND_DOWN` (never over-promise a payout)
- displayed basis points → `ROUND_HALF_UP` at 2 decimal places, presentation only

`Money` is serialised as `{ currency, minorUnits: "10000000", decimal: "100000.00" }` — the
string minor units are authoritative, `decimal` is a display convenience.

## 4. The provider port

A liquidity source is anything that can price a corridor. It is modelled as:

```ts
interface RouteProvider {
  readonly descriptor: ProviderDescriptor; // id, display name, rail, mode, licensing posture
  supports(request: QuoteRequest): boolean; // corridor / notional / rail eligibility
  fetchQuote(request: QuoteRequest, ctx: ProviderContext): Promise<ProviderQuote>;
}
```

`ProviderQuote` is intentionally _raw pricing input_, not a result:

```ts
interface ProviderQuote {
  providerId: ProviderId; // rule 12 — every quote is attributable
  quotedAt: string; // rule 11 — every quote is timestamped (ISO-8601 UTC)
  expiresAt: string | null;
  quoteReference: string | null; // the upstream provider's own quote id
  midMarketRate: string; // decimal string
  offeredRate: string; // decimal string
  fees: FeeSchedule; // fixed + proportional components
  settlement: SettlementEstimate; // p50/p95 seconds + business-day semantics
  slippage: SlippageModel; // bps by notional tier, or none
  reliabilityScore: string; // 0..1, provider historical success
  raw: JsonValue; // untouched upstream payload, persisted for audit
}
```

The engine derives cost from these primitives. A provider that returned a finished "total cost:
0.34%" would be rejected by the type system, which is how rule 8 is enforced structurally
rather than by convention.

Adapters are registered in a `ProviderRegistry` filtered by `PLATFORM_MODE`, so a sandbox
provider can never be served in production mode and an unlicensed provider can never be
registered for a corridor it is not authorised for.

## 5. Cost engine

`RouteCostEngine.price(request, quote)` produces a `PricedRoute`. The model:

1. **Deduct source-side fees** from the send amount (`sendAmount − fixedFees − proportionalFees`).
2. **Apply slippage** to the offered rate for rails that have execution slippage (AMM/DEX-like),
   using the provider's tiered bps model at the request notional.
3. **Convert** at the slippage-adjusted offered rate.
4. **Deduct destination-side fees** (e.g. local beneficiary credit fees).
5. **Benchmark** against mid-market: `benchmark = sendAmount × midMarketRate`.
6. `totalCost = benchmark − deliveredAmount`, expressed both as `Money` in the destination
   currency and as basis points of the benchmark.

Cost is measured against mid-market rather than against the provider's own rate, because the
FX spread is where most of the real cost of a cross-border payment hides. A route quoting "zero
fees" on a 90 bps spread must not appear cheaper than one charging a flat fee on the mid rate.

Every step is attributed in `CostBreakdown` so the UI can show exactly where the money went,
and so a disputed number can be traced to the provider primitive that produced it.

## 6. Route scoring

`RouteScorer` maps each priced route to a `0..100` score from three normalised, weighted
components — cost (default 0.6), speed (0.3), reliability (0.1). Weights are validated to sum
to 1 and are part of the persisted engine config, so a score can always be recomputed.

Normalisation is min–max across the candidate set, with a documented degenerate case: when all
routes tie on a component, every route receives the neutral value 1 for it rather than a
divide-by-zero. Ranking sorts by score, then cost, then settlement speed, then provider id —
fully deterministic, no dependence on provider response order.

## 7. Reproducibility

Reproducibility is a property we can _test_, not a claim:

1. The request is normalised into a canonical form.
2. Provider quotes are captured verbatim.
3. `fingerprint = sha256(canonicalJson({ engineVersion, request, quotes, config }))`.
4. The snapshot is persisted with the comparison.
5. `POST /v1/comparisons/:id/replay` re-runs the engine over the stored snapshot and reports
   whether the recomputed fingerprint and result match.

Canonical JSON sorts object keys, rejects floats-as-numbers on the money path and serialises
`bigint` as a string, so the hash is stable across machines and Node versions. The engine takes
a `Clock` port so tests are not time-dependent.

## 8. Persistence

Core declares ports; `persistence` implements them:

- `ComparisonRepository` — comparison snapshots and results, keyed by id, with idempotency-key lookup.
- `AuditLogRepository` — append-only financial event log.

Two drivers behind those ports: `memory` (default, used by tests and the demo) and `postgres`
(`pg` + the SQL migration in `packages/persistence/migrations`). The driver is chosen by
`DATABASE_DRIVER`; the API never learns which one it got. The Postgres audit table has no
`UPDATE`/`DELETE` path in application code — append-only is enforced by the repository API.

## 9. Error handling

One typed hierarchy in `core/errors`, each error carrying a stable machine-readable `code`, an
HTTP status hint and safe `details`. `AppError` subclasses cover validation, currency mismatch,
unsupported corridor, provider timeout/failure, no-routes-available, not-found and
not-implemented. The API has a single error serialiser producing:

```json
{ "error": { "code": "UNSUPPORTED_CORRIDOR", "message": "...", "details": {}, "requestId": "..." } }
```

Unexpected exceptions are logged with full context and returned as `INTERNAL_ERROR` with no
internals leaked. Provider failures are _partial_ failures: one dead provider degrades the
comparison (recorded in `providerErrors`) instead of failing the request.

## 10. Configuration

All configuration arrives through environment variables, parsed and validated once at startup
by a Zod schema that fails fast. No secret is ever read from source. Provider credentials are
namespaced per adapter (`PROVIDER_<ID>_API_KEY`) and resolved through a `SecretResolver` so a
vault backend can replace `process.env` without touching adapter code. `.env.example` documents
every variable; `.env*` is git-ignored.

`PLATFORM_MODE` ∈ `sandbox | production`. In `sandbox`, only sandbox providers register and
every API response carries `"mode": "sandbox"` plus a non-binding-quote disclaimer. Starting in
`production` without licensed adapters configured is a startup error, not a silent fallback.

## 11. Testing strategy

- **Unit** (`packages/core`) — money arithmetic, rounding boundaries, currency exponents, fee
  application order, slippage tiers, cost derivation, scoring/normalisation edge cases,
  canonical JSON and fingerprint stability.
- **Contract** (`packages/adapters`) — a shared conformance suite every `RouteProvider` must
  pass, so a future licensed adapter is validated against the same rules as a sandbox one.
- **Integration** (`apps/api`) — the app is built in-process and exercised via `fastify.inject`,
  covering happy paths, every validation failure, idempotency, replay determinism and the
  execution guard.

## 12. Deliberately out of scope for Phase 1

No execution, no custody, no wallets, no key management, no stablecoin issuance, no auth
provider integration, no DEX connectivity. `POST /v1/executions` exists and returns
`501 EXECUTION_NOT_IMPLEMENTED` — a deliberate, tested, audited refusal rather than an absent
endpoint, so the boundary is visible in the API surface itself.

See [ROADMAP.md](./ROADMAP.md) for the phase plan.
