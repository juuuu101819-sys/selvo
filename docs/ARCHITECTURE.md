# Meridian — Architecture

Meridian is a **global non-custodial financial routing hub**. It connects three rail families —
traditional finance, stablecoin finance, and DeFi liquidity — and performs:

**Discover → Quote → Compare → Route → Optimize → Delegate execution.**

The first shipped slice is B2B route comparison (all-in cost, mid-market benchmark, fee breakdown,
settlement time, slippage, composite score). That slice is reused, not replaced. Meridian is not a
custodian, not a principal, and not an execution venue. Settlement, when it exists, is delegated to
licensed or authorized providers.

Canonical product text: [MASTER_PRODUCT_DEFINITION.md](./MASTER_PRODUCT_DEFINITION.md).
Hard boundaries: [COMPLIANCE.md](./COMPLIANCE.md).

---

## 0. Architectural alignment

This section records the audit against the expanded product definition and the *minimum* changes
made. Nothing below rebuilds the application.

### Reuse as-is

- Decimal-safe money model, cost engine, scorer, fingerprints, audit log.
- `RouteProvider` plus capability ports (`MarketData`, `FX`, `Payment`, `Liquidity`) and the
  `FXRouteProvider` bridge. The engine still sees rails, not families.
- Existing priced rails: `bank_fx`, `payment_institution`, `stablecoin_settlement`,
  `liquidity_provider`. Reserved rails `dex_liquidity` and `treasury_product` were already in
  `RAIL_TYPES` and Prisma `ProviderRail`.
- Org-scoped auth, dashboard, comparison API, and the deliberate `501` on `POST /executions`.
- Schema non-custody: no balances, no settlement states, no key or wallet tables.

### Generalize (not replace)

- Flat rails now carry a **family** (`tradfi` / `stablecoin` / `defi`). HTTP may filter by
  `railFamilies`; the engine still receives a rail list.
- Execution story: “we never execute” remains true, and is now stated as **delegate to licensed
  partners — not implemented**. Distinct flags: `executeTransactions` (principal) vs
  `delegateExecution` (instruct a partner). Both false.
- `PLATFORM_CAPABILITIES` is the single source of truth for meta, tests and docs.
- `Principal.economicActor` (`human` | `business` | `ai_agent`) without a new auth kind. Sessions
  are humans; API keys are businesses; agents are not issued.

### Missing abstractions added (types and ports only)

- Rail families, `resolveRailFilter`, `availableRailsInFamily`.
- `ROUTING_PIPELINE` with `delegate` planned.
- Economic actors and `INTERACTION_MODELS` (agent flows planned).
- `PRODUCT` / `PRODUCT_KIND`.
- `DexLiquidityProvider` — **read-only `getDepth`**. Demo AMM is on the financial catalog, not the
  comparison engine.
- `FinancialProvider` — normalised `getQuote` / capabilities / assets / fees / liquidity across
  traditional, stablecoin and DeFi demo adapters.

### Deliberately not changed

- Quote engine request/snapshot shape and `ENGINE_VERSION` `2.0.0`. Family filters expand at the
  HTTP layer.
- Prisma schema and enums (`dex_liquidity` already existed).
- Sandbox adapters and pricing datasets.
- Comparison UI and dashboard behaviour.
- No DEX *execution*, no agent credentials, no delegated execution. Read-only DeFi quotes live on
  `POST /provider-quotes`.

### HTTP surface of this phase

- `GET /api/v1/meta` publishes product, pipeline, rail families, interaction models, expanded
  capabilities, and `execution.delegated: false`.
- `POST /api/v1/comparisons` accepts optional `railFamilies`, intersected with `rails`. A filter
  that names only planned rails (for example DeFi-only) is **400**, not a silent empty quote.
- `POST /api/v1/routes` ranks tradfi, stablecoin and DeFi quotes with a separate engine
  (`routingEngineVersion` 1.0.0). Comparison scoring is unchanged.
- Planned rails never expand into a comparison quote. Direct catalog quotes (ramps, AMM, aggregator)
  appear on `/routes` and `/provider-quotes`.

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
                  In-memory driver + Prisma/PostgreSQL driver behind one interface.
prisma/           Schema and migrations. The database's source of truth.
tests/e2e/        Playwright specs spanning both apps.
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

## 4a. Provider capabilities and resilience

`RouteProvider` above is the _engine-facing_ contract. Integrations are written against
capability-specific ones — `MarketDataProvider`, `FXProvider`, `PaymentProvider`,
`LiquidityProvider`, `DexLiquidityProvider`, and the catalog façade `FinancialProvider` — shaped
like the upstream APIs they wrap. `RouteFinancialProvider` presents an existing `RouteProvider`
through that façade without changing the engine. Demo AMM/aggregator/ramp implement
`FinancialProvider` directly. They are registered in `FinancialProviderRegistry`, not in
`ProviderRegistry`, so `POST /comparisons` is unchanged.

All of them share one thin base, `ProviderAdapter`, so a single resilience pipeline, recorder and
registry serve every kind of provider. Timeout, overall latency budget, bounded jittered retry of
transport failures, quote freshness and quote recording live in that pipeline rather than in each
adapter.

See [PROVIDERS.md](./PROVIDERS.md).

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
(Prisma with the `@prisma/adapter-pg` driver adapter, against the migrations in `prisma/`). The driver
is chosen by `DATABASE_DRIVER`; the API never learns which one it got.

Prisma is confined to this package. Nothing above the persistence layer imports it, which is what
keeps the store replaceable. Two properties are enforced in the database as well as in code: monetary
amounts are `DECIMAL(38, 0)` and are read with `toFixed(0)` rather than `toNumber()`, and the audit
table is append-only — the repository exposes no update or delete, and a trigger rejects both.

`docs/STACK.md` records why the older `prisma-client-js` generator is used and where the constraints
Prisma cannot express are added by hand.

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

## 10. Authentication

Organization-scoped. The parts that were hard to retrofit in Phase 1 are now wired:

- `Principal` carries `organizationId` (the tenant boundary), `subjectId`, `roles`, a `verified`
  flag, and `economicActor` (`human` for session users, `business` for API keys, `ai_agent`
  reserved and not issued). Handlers read the principal; they never take `organizationId` from the
  request body.
- `IdentityAuthenticator` accepts a session bearer (`mds_…`) or `X-Api-Key`, and still serves
  callers with no credential as anonymous on public routes. An unverifiable credential is `401`.
- Dashboard repositories filter by `organizationId` in the query. Cross-tenant ids return `404`.
- `Session` rows store only a token hash. Passwords are tagged scrypt hashes.

Out of scope: SSO, SAML, SCIM, MFA, federated identity.

## 11. Configuration

All configuration arrives through environment variables, parsed and validated once at startup
by a Zod schema that fails fast. No secret is ever read from source. Provider credentials are
namespaced per adapter (`PROVIDER_<ID>_API_KEY`) and resolved through a `SecretResolver` so a
vault backend can replace `process.env` without touching adapter code. `.env.example` documents
every variable; `.env*` is git-ignored.

`PLATFORM_MODE` ∈ `sandbox | production`. In `sandbox`, only sandbox providers register and
every API response carries `"mode": "sandbox"` plus a non-binding-quote disclaimer. Starting in
`production` without licensed adapters configured is a startup error, not a silent fallback.

## 12. Testing strategy

- **Unit** (`packages/core`) — money arithmetic, rounding boundaries, currency exponents, fee
  application order, slippage tiers, cost derivation, scoring/normalisation edge cases,
  canonical JSON and fingerprint stability.
- **Contract** (`packages/adapters`) — a shared conformance suite every `RouteProvider` must
  pass, so a future licensed adapter is validated against the same rules as a sandbox one.
- **Integration** (`apps/api`) — the app is built in-process and exercised via `fastify.inject`,
  covering happy paths, every validation failure, idempotency, replay determinism, API versioning,
  authentication and the execution guard.
- **End-to-end** (`tests/e2e`) — Playwright drives the built application over real HTTP in three
  projects: the API contract, the browser journey, and mobile layout. These are not a repeat of the
  integration tests: they exercise real sockets, real serialisation and real header defaults, which is
  where a body parser behaves differently from the in-process harness. The empty-body defect fixed
  earlier in this project was exactly that class of bug, so the suite sends a bodyless POST with a
  JSON content type on purpose.

## 13. Deliberately out of scope

No execution (principal or delegated), no custody of fiat or crypto, no wallets, no key management,
no stablecoin issuance, no auth-provider integration, no on-chain execution, no AI-agent payment
initiation. Read-only DeFi quotes exist on the financial catalog. `POST /v1/executions` exists and
returns `501 EXECUTION_NOT_IMPLEMENTED` — a deliberate, tested, audited refusal rather than an absent
endpoint, so the boundary is visible in the API surface itself.

See [ROADMAP.md](./ROADMAP.md) for the phase plan.
