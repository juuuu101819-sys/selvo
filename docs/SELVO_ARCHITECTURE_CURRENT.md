# SELVO — Current Architecture (as-built)

**Status:** inspection record. No code was changed to produce this document.
**Inspected tree:** `main` @ `c8808df`
**Method:** direct reading of `package.json`, `README.md`, `prisma/schema.prisma`, every router in
`apps/api/src/routes`, the engine and domain modules in `packages/core`, the adapters in
`packages/adapters`, the repositories in `packages/persistence`, the Next.js app in `apps/web`,
`.env.example`, `Dockerfile`, `docker-compose.staging.yml`, `.github/workflows/ci.yml`, the test
tree, and the existing `docs/` corpus.

## Naming

The product brand is **SELVO**. The codebase identifier is **Meridian** — npm package names
(`@meridian/core`, `@meridian/api`, …), the `meridian_session` cookie, credential prefixes (`mds_`,
`mk_`, `mag_`), the `X-Meridian-Actor` header, audit event names, user-facing UI strings, and all 16
pre-existing documents. A repository-wide search finds **zero** occurrences of "SELVO".

This document uses "SELVO" for the product and "Meridian" when naming an actual code symbol. A
rename is *not* proposed here: credential prefixes and the session cookie name are persisted data
and wire contract, so renaming is a migration, not a find-and-replace. Treat it as a separate,
scoped decision.

## Companion documents

This file is a single-page consolidation for architecture review. It does not replace the deeper
existing docs, which remain authoritative for their subject:

| Subject | Authoritative doc |
| --- | --- |
| Product identity, rail families, pipeline | `MASTER_PRODUCT_DEFINITION.md` |
| Layered architecture narrative | `ARCHITECTURE.md` |
| HTTP reference (largest doc, ~1,100 lines) | `API.md` |
| Schema narrative, CHECK constraints | `DATABASE.md` |
| Quote/ranking mathematics | `QUOTE_ENGINE.md` |
| Provider adapter contract | `PROVIDERS.md` |
| Sessions, MFA, OIDC | `AUTH.md` |
| Agent credentials | `AGENTS.md` |
| Non-custodial boundaries and phase gates | `COMPLIANCE.md` |
| Production-locked operator contract | `PRODUCTION_GATES.md` |
| Finding catalog (PA-C/H/M/L) | `PRODUCTION_AUDIT.md` |
| Live-flag legal sign-off | `GO_LIVE_CHECKLIST.md` |
| Deploy/rollback runbook | `DEPLOYMENT.md` |
| Phase history and blocked phases | `ROADMAP.md` |
| Agent spending envelopes (design only) | `TREASURY_DESIGN.md` |
| Referral-MVP readiness report | `PRE_LAUNCH_READINESS.md` |

---

## 1. Current architecture

### 1.1 Repository shape

npm workspaces monorepo, ESM, Node ≥ 20.11, TypeScript 5.9, strict project references.

| Workspace | Purpose | Size |
| --- | --- | --- |
| `packages/core` | Domain model, money, quote/routing engines, policy, mandates, ports. No I/O, no Prisma. | 235 files / ~36.2k lines |
| `packages/adapters` | Provider adapters, resilience wrappers, sandbox datasets, sandbox execution partner. | 38 files / ~7.0k lines |
| `packages/persistence` | Repository implementations: Prisma/Postgres driver and an in-memory driver. Only layer importing Prisma. | 45 files / ~8.6k lines |
| `apps/api` | Fastify HTTP surface, composition root (`container.ts`), env schema, OpenAPI generation. | 113 files / ~21.5k lines |
| `apps/web` | Next.js 16 App Router UI, next-intl, server actions. | 120 files / ~13.4k lines |
| `tests/e2e` | Playwright specs (`api`, `web`, `mobile` projects). | 8 specs / 55 cases |
| `prisma` | Schema + 22 migrations + seed. | 1,387-line schema |

Dependency direction is one-way: `core` depends on nothing internal; `adapters` and `persistence`
depend on `core` ports; `apps/api` composes all three; `apps/web` never imports `core` and instead
re-declares the wire contract in `apps/web/src/lib/api/types.ts`.

### 1.2 Runtime topology

Two independent processes. There is no reverse proxy, no queue, no Redis, no cache tier.

```
browser ──▶ apps/web (Next.js, :43117)
                │  server-side fetch, Authorization: Bearer <mds_…>
                │  (the session cookie is NEVER forwarded to the API)
                ▼
            apps/api (Fastify, :47311) ──▶ Postgres (Prisma)
                │
                └──▶ in-process provider adapters (dataset-driven; no outbound pricing calls)
```

`apps/web` is not in the API Docker image; they deploy separately.

### 1.3 Request pipeline (API)

`apps/api/src/app.ts` registers, in order: container construction → CORS → `onRequest` (request id
header, HSTS when production-locked) → JSON body parser → error handler → route collector → routes.
The `/api/v1` plugin then layers authentication → rate limiting → request logging → route modules.
Every `/api/v1` route is also mounted on a deprecated `/v1` prefix that emits `Deprecation: true`
plus a `Link` successor header.

### 1.4 Pricing pipeline (the core read path)

`POST /comparisons`, `POST /routes` and `POST /quote` all funnel into a single engine —
`MultiRailRouter` (`packages/core/src/engine/routing-engine.ts`, `ROUTING_ENGINE_VERSION 2.0.0`):

```
validate corridor (conversionKindOf)
  → FinancialProviderRegistry.eligible()        mode + licensing + rail + partner-corridor filter
  → provider.getQuote() in parallel             per-provider timeout, default 4,000 ms
  → admitNormalizedQuote()                      clock-skew → expiry → rail max-age; fail closed
  → MultiRailCostEngine.price()                 all-in cost vs mid-market benchmark
  → RailHealthMonitor.observe()                 reliability + liquidity headroom (+ optional probe)
  → MultiRailScorer.score()                     7 weighted factors, min-max normalised
  → audit routing.completed
```

A separate, non-pricing **graph discovery** path (`packages/core/src/graph/*`, surfaced at
`GET /route-graph`, `POST /route-graph/paths`, `POST /routes/search`) walks indicative topology for
multi-hop conversions. Its edges carry `executable: false` and it never feeds prices into the
ranking engine.

A legacy fiat-only stack (`cost-engine.ts` + `route-scorer.ts`, `ENGINE_VERSION 2.0.0`) still exists
for seed and tests but is **not on any HTTP path** — PA-H05 moved `/comparisons` to `MultiRailRouter`.

---

## 2. Current database entities

Postgres via Prisma. **41 models, 19 enums, 22 migrations.** Conventions enforced schema-wide:
monetary amounts are `Decimal(38, 0)` counts of minor units, rates are `Decimal(38, 18)`, closed
sets are Postgres enums, and the repository converts `Decimal` to an exact string at the boundary and
never calls `toNumber()`.

| Group | Models |
| --- | --- |
| Reference | `Currency` |
| Tenancy & identity | `Organization`, `User`, `OrganizationMember`, `OrganizationInvite`, `ApiKey`, `Session` |
| Auth hardening | `MfaRecoveryCode`, `MfaChallenge`, `OrganizationOidcConnection`, `OidcAuthorizationState` |
| Providers | `Provider`, `ProviderCapability`, `ProviderCredential`, `RoutingManualOverride`, `LiveEnablement` |
| Routes & pricing | `Route`, `CustomerPricing` |
| Requests & quotes | `TransactionRequest`, `Quote`, `QuoteLeg`, `Fee` |
| Agents | `Agent`, `AgentCredential`, `AgentWalletReference`, `Merchant`, `PaymentPolicy`, `PaymentIntent` |
| Mandates | `Mandate`, `MandateX402Challenge` |
| Intent & execution | `ExecutionIntent`, `PartnerInstruction`, `OrchestratedExecution`, `ExecutionReceipt` |
| Monetization | `MonetizationEvent`, `Invoice`, `InvoiceLine` |
| Reproducibility & audit | `Comparison`, `RoutingEvaluation`, `AuditLog` |
| Infrastructure | `RateLimitBucket` |

### 2.1 Non-custody enforced by the schema itself

This is the most important property of the data model and must not be eroded:

- **There is no balance, wallet, ledger, float, or funded-position table.** A guardrail test
  (`packages/core/src/domain/custody-guardrail.test.ts`) fails the build if a custody-shaped table
  or column is introduced.
- `TransactionRequestStatus` has **no** `settled`, `executed`, `funded`, or `in_flight` value. Adding
  one requires a migration and the compliance checklist — deliberate friction.
- `ExecutionIntentStatus` has exactly one value: `recorded`. `executable` and `submitted` are
  `Boolean @default(false)` and pinned by CHECK constraints.
- `OrchestratedExecution` and `ExecutionReceipt` carry explicit `fundsMoved`, `custody`,
  `transferSigned`, `meridianKeysUsed` columns that default to `false` and are asserted false in
  tests, plus `sandbox @default(true)`.
- `MonetizationEvent` carries `fundsMoved`, `custody`, `realExecution` (all `false`) and
  `realizedRevenue @default(false)`.
- `AgentWalletReference.controlledByPlatform` defaults `false` and is typed `false` in the domain —
  it is an external handle, never a platform-controlled wallet.
- `providers` stores **no credentials**. Adapter secrets are AES-256-GCM rows in
  `provider_credentials` (`v1$iv$ciphertext$tag`, CHECK-enforced).
- `audit_logs` is append-only: the repository exposes no update or delete, *and* a database trigger
  rejects `UPDATE`/`DELETE` (`prisma/migrations/20260826120000_init/migration.sql`).

---

## 3. Current API surface

**108 registered handlers**: 2 unversioned (`GET /health`, `GET /ready`) and 106 under `/api/v1`,
each also mirrored on the deprecated `/v1` prefix. The OpenAPI 3.0.3 document is generated from
`API_V1_ROUTE_CATALOG` (`apps/api/src/openapi/catalog.ts`) and served at
`GET /api/v1/openapi.json`; tests assert every implemented route appears in the catalog and vice
versa.

| Module | Routes | Notes |
| --- | --- | --- |
| `system.ts` | 3 | `/health`, `/ready` (503 on persistence failure), `/api/v1/health`, `/meta` |
| `openapi.ts` | 1 | Document built once at startup |
| `auth.ts`, `auth-mfa.ts`, `auth-oidc.ts` | 10 | Login (202 + `mfc_` challenge when MFA due), logout, `/auth/me`, TOTP enroll/confirm/verify/recovery, OIDC start/callback |
| `comparisons.ts` | 5 | Public fiat comparison, keyset list, fetch, replay, per-comparison audit |
| `routing.ts` | 2 | Public multi-rail `POST /routes`, replay |
| `simulate.ts`, `route-graph.ts`, `stablecoin-routes.ts`, `defi-routes.ts` | 7 | Public simulation, graph discovery, stablecoin and DeFi corridors |
| `financial-routing.ts` | 5 | `/assets`, `/currencies`, org-scoped billed `POST /quote` + replay, `POST /routes/search` |
| `providers.ts` | 3 | Catalog, detail, single-provider indicative quote |
| `api-keys.ts` | 3 | List prefixes, mint (`mk_`), revoke |
| `agent-payments.ts` | 15 | Agent CRUD, merchants, policies, payment-intent lifecycle (create → quote → select → authorize → simulate) |
| `nl-routing.ts` | 2 | `POST /agent/interpret`, `POST /agent/route` |
| `mandates.ts` | 3 | Verify, fetch, revoke |
| `partner-instructions.ts` | 4 | Sandbox partner catalog, dispatch, poll, **unauthenticated** partner webhook |
| `dashboard.ts` | 16 | Metrics, quotes, transactions, providers, revenue, settings, agents, policies, execution-authorization |
| `onboarding.ts` | 6 | Operator org creation, invite accept, checklist, KYB submit/review, pricing attach |
| `ops-routing.ts`, `ops-live-enablement.ts`, `billing.ts` | 15 | Kill switches, provider credential vault, live-enablement rows, billing runs, reconciliation report, tenant invoices |
| `execution-intents.ts`, `executions.ts`, `receipts.ts`, `reconciliation.ts` | 7 | Intent record/list, gated execution orchestration, Ed25519 receipt verify, mismatch report |
| `audit-export.ts` | 1 | Owner/admin tenant audit export |

Response envelope is uniform: `{ data, meta: { disclaimer, requestId } }` on success,
`{ error: { code, message, details, requestId } }` on failure. `X-Request-Id` is echoed on every
response. Error codes are a closed enum in `packages/core/src/errors`.

### 3.1 The execution gate

`POST /api/v1/executions` audits the attempt and returns **501** before any auth or org check when
`EXECUTION_ENABLED` is false (the default, and the only legal value in a production-locked process):

```ts
// apps/api/src/routes/executions.ts:42
if (!container.config.executionEnabled) {
  await container.auditLogger.record({ type: 'execution.rejected', /* … */ });
  throw new ExecutionNotImplementedError();
}
```

`GET /meta` always advertises `execution: { implemented: false, delegated: false, statusCode: 501 }`.
Other structurally disabled paths: `GET /executions/:id`, `GET /executions/:id/receipt` and
`GET /reconciliation/mismatches` → 403 when `EXECUTION_ENABLED=false`; `POST /mandates/verify` → 403
when `MANDATE_INGESTION_ENABLED=false`; `POST /payment-intents/:id/simulate` → 501 when
production-locked; the three `POST /ops/billing/{collect,subscriptions/run,partner-payouts/run}`
routes → **always 403** with an audited refusal.

---

## 4. Current security model

### 4.1 Authentication

Five credential kinds, all verified server-side by `IdentityAuthenticator`:

| Kind | Prefix | Transport | Storage |
| --- | --- | --- | --- |
| Human session | `mds_` | `Authorization: Bearer` (web keeps it in an httpOnly cookie) | HMAC-SHA256 under a pepper derived from `AUTH_SECRET`; 12 h TTL |
| Organization key | `mk_` | `Bearer` or `X-Api-Key` | scrypt hash + 16-char public `keyPrefix` |
| Agent credential | `mag_` | `Bearer` or `X-Api-Key` | scrypt hash + `keyPrefix` |
| MFA challenge | `mfc_` | request body | hashed, single use |
| Ops operator | — | `X-Onboarding-Operator-Key` | SHA-256 compare against `ONBOARDING_OPERATOR_SECRET`, never on `AppConfig` |

Passwords: scrypt `N=16384, r=8, p=1, keylen=32`, 16-byte per-hash salt, tagged
`scrypt$N$r$p$salt$key`. Secrets (session token, API key, agent secret, TOTP seed, recovery codes,
invite token) are returned exactly once at issue and never again. TOTP seeds and OIDC client secrets
are AES-256-GCM ciphertext. `X-Meridian-Actor` is read for logging and **ignored for identity**.
Login returns a constant 401 for unknown-user and wrong-password. Absent credentials yield an
`anonymous` principal (public routes work); an *invalid* credential is a hard 401, never a silent
downgrade.

Web session cookie (`apps/web/src/lib/session-cookie.ts`): `meridian_session`, always `HttpOnly`,
always `SameSite=Lax`, `Secure` when `PLATFORM_MODE=production` or `COOKIE_SECURE=true` or
(`NODE_ENV=production` and `COOKIE_SECURE !== 'false'`). `COOKIE_SECURE=false` with
`PLATFORM_MODE=production` **throws at startup**.

### 4.2 Authorization

Roles are `owner | admin | member | viewer`. Roles map to *session scopes* rather than being checked
ad hoc (`packages/core/src/domain/api-scope.ts`):

- `viewer`, `member` → `quote:read`, `route:read`
- `admin`, `owner` → those plus `agent_policy:write`, `mandate:revoke`

Human sessions **never** receive `payment:*`, `transaction:create`, or `mandate:verify` — those are
machine-only scopes. Enforcement helpers: `requireOrganization`, `requireCapability`/`requireScope`,
`capabilityPreHandler`, `requireKeyManager` / `requirePrivilegedSession` (owner/admin human session),
`assertClaimedOrganization`.

**Viewer cannot reach** any of: agent policy PATCH, mandate revoke, API-key or agent mint/revoke,
org auth settings, execution-authorization flags, execution intents, the agent payment pipeline, or
audit export. This is directly regression-tested (`agent-dashboard.test.ts` covers viewer *and*
member).

### 4.3 Organization isolation

`organizationId` is always taken from `Principal.organizationId`, resolved server-side from the
verified credential. Where a client may echo an org id (`POST /quote`, `POST /routes/search`),
`assertClaimedOrganization` requires it to equal the principal's org (401 unverified / 403 mismatch).
Client-supplied resource ids (`agentId`, `mandateId`, invoice/quote/tx ids) are always loaded through
an org-scoped query, and cross-tenant reads return **404** rather than 403.
`tenant-isolation.test.ts` sweeps catalogued org-scoped routes for leaks.

### 4.4 Validation, limits, logging, audit

- **Zod** at the HTTP boundary via `parseOrThrow`, mostly `.strict()` so unknown keys are rejected.
- **Rate limiting**: one global fixed-window limiter over the whole `/api/v1` plugin, default
  120 req / 60 s, keyed `principal:<kind>:<subjectId>` when verified and `ip:<addr>` otherwise —
  never on a client-supplied value. Backed by the shared `rate_limit_buckets` table on Postgres so
  replicas share counters (in-memory map on the memory driver). `/health` and `/ready` are exempt.
- **Idempotency**: optional `Idempotency-Key` (8–128 chars) on `POST /comparisons`,
  `POST /payment-intents`, `POST /agent/route`, and `POST /executions` when enabled. Same key with a
  different payload fingerprint → 409.
- **Logging**: Pino with an explicit `redact` list covering `authorization`, `cookie`, `x-api-key`,
  the operator key, `password`, `secret`, `clientSecret`, `challengeToken`, `*.AUTH_SECRET`,
  `*.DATABASE_URL`, `*.token`, with `remove: true`. Error responses are sanitized by
  `public-error.ts`, which strips detail keys matching token/secret/password.
- **Audit**: `AuditLog` with a closed set of **83** event types. Fields are `eventId`, `type`,
  `occurredAt`, `actor`, `organizationId?`, `requestId?`, `comparisonId?`, `providerId?`, `payload`.
  Append-only by repository *and* database trigger. Failed-auth attempts are audited with hashed
  identifier prefixes. Tenant export is owner/admin only and filtered to the caller's org.

---

## 5. Current routing model

### 5.1 Normalized quote

`NormalizedQuote` (`packages/core/src/ports/financial-provider.ts`) is the single pricing currency of
the system: `providerId`, `timestamp` (quotedAt), `expiresAt`, `quoteReference`, `conversionKind`,
`sourceAsset`, `targetAsset`, `amountMinorUnits`, `indicatedRate`, `midMarketRate`, `fees[]`,
`settlement` (p50/p95 seconds, business-days flag, UTC cutoff), `liquidity` (available depth, venue,
chain), `slippage`, `reliabilityScore`, `chainId`, `metadata`, and a literal `executable: false`.

### 5.2 Cost identity

```
benchmark = send × mid
delivered = ((send − sourceFees − platformFees) × indicatedRate × (1 − slippage)) − destFees
totalCost = benchmark − delivered
```

Fee buckets: `provider`, `platform`, `network`, `gas`, `liquidity`, `surcharge`, `other`. Arithmetic
runs on a 34-significant-digit `Decimal` clone that **rejects JS `number` as input by type**
(`packages/core/src/money/decimal.ts`); minor units are `bigint`; amounts cross boundaries as
strings. `number` survives only for whole-second settlement estimates.

### 5.3 Freshness

`FreshnessPolicy` defaults to 120 s max age, 5 s clock-skew tolerance, 1 s expiry guard, with
per-rail max ages: `dex_liquidity` 12 s, `stablecoin_settlement` 45 s, `liquidity_provider` 60 s,
`bank_fx`/`payment_institution`/`treasury_product` 120 s. Enforced at three points — quote fetch,
pricing time, and selection (`assertSelectionQuoteFresh` fails closed when `expiresAt` is null or
past, surfacing 409 `requoteRequired`). The in-process quote cache only serves `fresh` entries.

### 5.4 Scoring (current best-execution)

`MultiRailScorer` (`packages/core/src/engine/routing-scorer.ts`) — seven factors, default weights
summing to exactly 1 and validated as such at startup:

| Factor | Weight | Normalisation |
| --- | --- | --- |
| `cost` | 0.30 | min-max, lower better (all-in `totalCostBps`) |
| `speed` | 0.15 | min-max, lower better (p50 seconds) |
| `fxRate` | 0.15 | min-max, higher better (indicated vs mid) |
| `finality` | 0.10 | absolute settlement confidence from p50/p95 tail, cutoff, business days |
| `slippage` | 0.10 | min-max, lower better |
| `liquidity` | 0.10 | headroom ÷ 2× comfort multiple, clamped |
| `compliance` | 0.10 | rule-based from licensing tier, KYC, sanctions flags |

Score is scaled to 0–100 at 2 dp, then multiplied by a rail-health factor (degraded ×0.55, dry
liquidity ×0.70, thin ×0.85, stacking); rails observed `down` are excluded before scoring.
Tie-break order: deprioritized-last → score → cost → p50 → routeId. Callers receive `routeScore`,
the full `scoreComponents` breakdown, `rank`, `recommended`, a templated `routeExplanation`, and a
`bestExecution` attestation (weights, rationale, `rationaleHash`, up to three alternatives,
rail-health snapshot, `constraintsSatisfied[]`).

Against a "Best Execution 2.0" target, present today: price, fees, spread, gas (inside cost),
slippage, liquidity, settlement time, provider health, compliance eligibility. **Enforced but not
scored:** quote freshness (admission gate). **Partial:** reliability and historical success rate
(they drive rail health, not a weighted factor). **Absent:** counterparty risk — `ProviderQuote.risk`
exists and the *legacy* scorer consumed it, but `MultiRailCostEngine` does not.

### 5.5 Failure semantics

- `UNSUPPORTED_CORRIDOR` (422): zero eligible providers after registry, rail and partner-corridor
  filters, or an unsupported conversion kind.
- `NO_ROUTES_AVAILABLE` (422): providers existed but every quote failed admission, pricing, or
  health.

These are the errors a production deployment with an empty licensed registry returns for every
corridor — the intended fail-closed behaviour, not a bug.

### 5.6 Graph and rails

Rail families: `tradfi` (`bank_fx`, `payment_institution`, `liquidity_provider`, planned
`treasury_product`), `stablecoin` (`stablecoin_settlement`), `defi` (`dex_liquidity`, still
`planned` on `/comparisons`). Graph node kinds: `FIAT`, `STABLECOIN`, `CRYPTO_ASSET`, `BANK`,
`FX_PROVIDER`, `PAYMENT_PROVIDER`, `DEX`, `AMM`, `LIQUIDITY_POOL`, `SETTLEMENT_PROVIDER`.

Two structural limits worth stating plainly:

1. A priced multi-rail "route" is **one provider's single conversion**, not a composed multi-leg
   walk. Multi-hop exists only in unpriced graph discovery; `plannedRoutesOf()` returns a
   `future-dex-hop` placeholder marked `status: 'planned'`.
2. **No tokenized-asset concept exists anywhere.** Supported non-fiat assets are USDC, USDT, ETH.
   "Token" elsewhere in the repo means an auth token.

---

## 6. Current provider model

Two registries, both filtering on platform mode *and* licensing:

```ts
// packages/core/src/engine/financial-registry.ts:54
if (mode === 'production' && licensing === 'unlicensed_sandbox') {
  exclusions.push({ providerId: id, reason: 'sandbox pricing is never served in production mode' });
  continue;
}
```

`ProviderRegistry` holds fiat `RouteProvider`s; `FinancialProviderRegistry` holds multi-rail
`FinancialProvider`s. The `providers` DB table is the *operational catalog* (licensing,
jurisdictions, modes, `adapterId`, `pricingVersion`, `reliabilityScore`, `quoteTtlSeconds`) and is
credential-free; the live adapter instances are constructed in `apps/api/src/container.ts`.

`FinancialProvider` contract: `getCapabilities`, `getSupportedAssets`, `getSupportedCurrencies`,
`supportsNormalized`, `getQuote`, `getSettlementEstimate`, `getFees`, `getLiquidityInfo`, optional
`probe`. Conformance is machine-checked by `checkProviderContract()`.

**Every adapter in the tree is dataset- or table-driven. None calls an external pricing API.**

| Adapter | Source |
| --- | --- |
| `DataDrivenSandboxProvider` (4 sandbox providers) | `packages/adapters/data/sandbox-providers.json` + `reference-rates.json` |
| `DemoStablecoinRampProvider`, `DemoAmmProvider`, `DemoDexProvider`, `DemoDexAggregatorProvider` | hardcoded rate tables |
| `RouteFinancialProvider`, `FXRouteProvider` | bridges over the above |
| `SandboxExecutionPartner` | mock settlement, not quoting |

Availability controls: optional `probe()`, a circuit breaker (3 failures → open 30 s; while open
`supportsNormalized` returns false), an operator `ManualOverrideRegistry` kill switch persisted in
`routing_manual_overrides`, and the rail-health monitor.

---

## 7. Current AI functionality

**There is no LLM in this system.** No `openai`, `anthropic`, `@google/*`, `langchain`, or `ai`
dependency exists in any workspace. What the product calls "natural-language routing" is a
deterministic regex parser plus a rule engine, and it is explicit about that in code:

```ts
// packages/core/src/domain/optimization-preference.ts:32
export const NL_INTERPRETER = 'deterministic_parser' as const;
```

`aiUsed: false` is a literal type on the parse result and on every policy decision.

| Surface | Behaviour |
| --- | --- |
| `POST /api/v1/agent/interpret` | Runs stages `natural_language` → `intent_parser` only. Returns a `StructuredNlPaymentIntent`. Agent credential + `payment:create`. |
| `POST /api/v1/agent/route` | Full declared pipeline: parse → policy → routing → provider quote → route selection → recorded execution intent. Requires `payment:create` + `payment:quote` + `payment:authorize`. |

The parser resolves the payee against the org's `Merchant` rows, validates asset codes, and converts
to minor units. Critically, it sets `financialsComputedBy: null` and
`didNotCompute: ['exchange_rates', 'fees', 'slippage', 'settlement_amounts']` — every financial
number still comes from `MultiRailRouter` after policy evaluation. Route explanations are
template-generated from deterministic route fields, not model output.

So the architectural separation the target design demands ("AI reasons, deterministic backend
decides") is already structurally true — because the reasoning layer is currently a parser. Adding a
real model means adding an untrusted-input boundary that does not exist yet.

---

## 8. Current transaction intent model

Five distinct intent-shaped entities. Their statuses are deliberately worded to never read as
settlement (`packages/core/src/domain/financial-status.ts` lists `AUTHORIZED`, `EXECUTION_PENDING`,
`COMPLETED` as **retired** names that must not reappear).

| Entity | Statuses | Meaning |
| --- | --- | --- |
| `TransactionRequest` | `draft`, `quoted`, `quotes_expired`, `quote_selected`, `cancelled` | Human/business pricing request. No settlement state exists. |
| `PaymentIntent` | `CREATED`, `QUOTING`, `QUOTED`, `ROUTED`, `POLICY_APPROVED`, `SIMULATION_PENDING`, `SIMULATION_COMPLETED`, `FAILED`, `EXPIRED` | Agent payment lifecycle. Terminal success is a *simulation*. |
| `ExecutionIntent` | `recorded` (only) | Recorded route choice. `executable`/`submitted` pinned false. |
| `OrchestratedExecution` | `CREATED`, `ROUTED`, `COMPLIANCE_PASSED`, `COMPLIANCE_REVIEW`, `BLOCKED`, `EXPIRED`, `DISPATCHED`, `SETTLING`, `SETTLED`, `FAILED` | Sandbox mandate+route orchestration against a **mock** partner. `fundsMoved` stays false even at `SETTLED`. |
| `Mandate` | `verified`, `revoked` | Signed agent authorization (AP2 intent/cart, x402, MPP). |

Transitions are enforced in `AgentPaymentService` and `ExecutionOrchestrationService`, not in the
route handlers. Daily-spend reservation counts `ROUTED`, `POLICY_APPROVED`, `SIMULATION_PENDING`,
`SIMULATION_COMPLETED` so in-flight intents consume the envelope (PA-H04).

### 8.1 Policy engine

`evaluatePaymentPolicy` (`packages/core/src/domain/payment-policy.ts`) returns a deliberately
narrow type:

```ts
export interface PolicyDecision {
  readonly allowed: true;
  readonly aiUsed: false;
  readonly failClosed: true;
}
```

There is no `{ allowed: false }` — a denial *throws* `PolicyDeniedError` carrying one of 15
`POLICY_RULES` (`maximum_transaction_amount`, `daily_spending_limit`, `allowed_assets`,
`allowed_chains`, `allowed_providers`, `allowed_countries`, `allowed_recipients`, `maximum_fee`,
`minimum_route_score`, `minimum_liquidity`, `maximum_slippage`, `preferred_route_preference`,
`route_policy`, `mandate_scope`, `policy_required`). Unknown route metrics (null score, slippage, or
liquidity when a minimum is configured) **fail closed**. Every evaluation writes
`payment.policy.evaluated`; denials additionally write `payment.policy.denied`.

`PaymentPolicy` fields that exist today: `maxTransactionAmountMinorUnits`, `allowedAssets`,
`allowedRecipientCodes`, `allowedProviderIds`, `allowedChainIds`, `allowedCountryCodes`,
`maxFeeBps`, `maxSlippageBps`, `minRouteScore`, `minLiquidityHeadroom`,
`dailySpendingLimitMinorUnits` + `dailySpendingAsset`, `preferredRoutePreference`.
**Absent:** monthly limit, required settlement time, human-approval threshold, and any notion of a
**policy version** (one row per agent, `@@unique([organizationId, agentId])`, no history table).

### 8.2 Authorization and human-in-the-loop, as they actually stand

There is **no unified authorization-decision record**. `POST /payment-intents/:id/authorize` is a
policy re-check that sets `POLICY_APPROVED`; the name is misleading and it is not a human step. The
closest persisted artifacts are audit rows, `PaymentIntent.authorizedAt`, and orchestration status.
Of the target decision fields, `policyVersion`, a unified `authorizationDecision`, and `riskFlags`
have no representation at all.

Human consent exists only as two owner/admin endpoints
(`POST /dashboard/execution-authorization`, `POST /dashboard/agents/:id/execution-authorization`)
that set `executionAuthorized` flags. They are audited and explicitly record
`functionalEffect: 'none', executionsRemain501: true` — consent is captured, nothing is enabled.
The compliance `review` outcome parks an orchestration at `COMPLIANCE_REVIEW` with **no queue, UI, or
release path**. A `PENDING_APPROVAL → APPROVED/REJECTED/EXPIRED` workflow does not exist.

### 8.3 Compliance, as it actually stands

`COMPLIANCE_OUTCOMES = ['pass', 'deny', 'review']`. In sandbox orchestration the outcome is
**supplied by the caller** and an omitted value defaults to `'pass'`; an unrecognised string throws
`ValidationError` with `failClosed: true`. There is no `UNKNOWN` state. Real controls that do exist:
org-level manual KYB (`unverified | pending | verified | rejected`) gating licensed quotes with a
403 `ONBOARDING_INCOMPLETE`, policy jurisdiction allowlists, and route compliance metadata
(licensing tier, `kycRequired`, `sanctionsScreeningRequired`). **No sanctions screening API, no
automated KYC/KYB, no per-intent compliance decision record.** Note that `complianceOf()` currently
always sets `eligible: true`, so the compliance score varies by licensing tier but never zeroes a
route out.

### 8.4 Settlement, reconciliation, receipts

`PartnerInstruction` (`accepted | settling | partial | settled | failed`) stores only
`instructionHash` and `signatureHash`. Instruction signing uses a **partner-scoped HMAC**
(`instructionSignatureKind: 'partner_credential_hmac'`) — it is not a customer transfer signature.
`ReconciliationEngine` detects eight mismatch kinds (`missing_partner_confirmation`,
`instruction_hash_mismatch`, `amount_mismatch`, `filled_amount_mismatch`,
`partner_status_mismatch`, `missing_fee_attribution`, `fee_tpv_mismatch`,
`non_custodial_violation`). Ed25519 receipts (`RECEIPT_SIGNATURE_ALGORITHM = 'Ed25519'`) are issued
after a sandbox `SETTLED` and are independently verifiable at `POST /receipts/verify`.

What "finality" means today: **a mock partner said so.** Nothing in the system observes a bank,
chain, or licensed provider. There is no `SettlementRail`, `SettlementProvider`,
`SettlementInstruction` (generic), `SettlementAttempt`, `SettlementEvent`, or
`ReconciliationRecord` model.

### 8.5 Monetization

`MonetizationEvent` records quoted economics only: nine `REVENUE_SOURCES` (FX/payment/stablecoin/
DeFi/liquidity routing fees, partner referral commission, enterprise API subscription, AI agent
payment fee, enterprise volume pricing), four transaction types, four `ECONOMIC_STAGES`
(`route_quote`, `route_selected`, `execution_intent`, `settled`), and
`REVENUE_RECOGNITION_STATUSES = ['unrealized', 'invoiced', 'collected']` where `collected` is never
written. Invoices are generated from snapshots with `status: 'issued'`,
`collectionStatus: 'uncollected'`, `taxCalculation: 'deferred'`, `issuerLegalEntity: 'unconfirmed'`.

**No payment processor integration exists** — no Stripe, no PSP, no card vault.
`DeferredPlatformFeeCollector` deliberately does not collect. There is **no subscription plan
catalog and no public pricing page.** Per-org API *call* usage is not metered for billing anywhere;
`rate_limit_buckets` is a throttle, and dashboard "provider usage" counts quotes, not API calls.

### 8.6 Treasury

No treasury models, ledger, or balances exist. `treasury_product` is a declared rail with no
adapter. `docs/TREASURY_DESIGN.md` (472 lines) is design-only and explicitly rejects in-platform
spendable balances; its open questions are unresolved.

---

## 9. Current demo / live separation

The target design asks for four environments. **The code has two**:

```ts
// packages/core/src/domain/provider.ts:6
export const PLATFORM_MODES = ['sandbox', 'production'] as const;
```

`DEMO`, `SIMULATION`, and `PARTNER_SANDBOX` exist as *other axes*, not as platform modes:

| Concept | How it is actually represented |
| --- | --- |
| `PLATFORM_MODE` | `sandbox` \| `production` — the only mode enum |
| DEMO | `SEED_DEMO_TENANTS` flag, demo tenant credentials, `includeDemoAdapters` (sandbox only) |
| SIMULATION | `PaymentIntent.SIMULATION_*` statuses; `OrchestratedExecution.sandbox = true` |
| PARTNER_SANDBOX | `ExecutionPartner.kind = 'sandbox_mock'` vs `'live'`, gated by `PARTNER_LIVE_ENABLED` |
| PRODUCTION | production-locked process = `NODE_ENV=production` **or** `PLATFORM_MODE=production` |

**Production cannot silently fall back to demo pricing.** Three independent mechanisms:

1. `container.ts` returns an **empty provider list** in production and throws `ConfigurationError` if
   `PRODUCTION_ROUTING_AVAILABLE=true` without licensed adapters.
2. Both registries reject `unlicensed_sandbox` licensing when mode is `production`.
3. `includeDemoAdapters` is hard-wired to `config.mode === 'sandbox'` for both the financial catalog
   and the route graph.

The consequence is that **a production deployment today returns `UNSUPPORTED_CORRIDOR` for every
corridor**, because the licensed registry is empty by design. That is the intended posture until
PHASE 30 partner adapters exist.

Production-locked startup additionally refuses: the memory database driver, a missing/short/demo
`AUTH_SECRET`, `SEED_DEMO_TENANTS=true`, `EXECUTION_ENABLED=true`, `DEPLOY_ENV=development`, and
`PRODUCTION_EXECUTION_AVAILABLE=true` (which fails **in every** environment — it is hard-coded false
in the resolved config). Routing/scoring weight overrides must be complete and sum to exactly 1.

### 9.1 What the UI tells the user

The site header renders a badge from `meta.mode` — `Sandbox` (i18n key `header.sandbox`) when
sandbox, otherwise the raw mode string. Provider rows carry a licensing badge
(`unlicensed_sandbox` → amber "Sandbox", `licensed_partner`, `internal_model`). Nine page-specific
footer notices carry non-custodial and sandbox language. There is **no explicit LIVE or DEMO badge**
and no visual system that distinguishes live from simulated numbers per data point.

---

## 10. Current production blockers

From `PRODUCTION_AUDIT.md` (3 CRITICAL, 13 HIGH, 16 MEDIUM, 6 LOW): **all CRITICAL and all HIGH are
marked FIXED (2026-08-28)**, including PA-C01 "Production mode has no licensed adapters and cannot
start", PA-C02 "Demo tenants provision whenever `NODE_ENV` is not `test`", and PA-C03 "In-memory
persistence is the default, including for a 'production' Node environment". PA-M09 is PARTIAL
(invoices shipped; collection, tax, subscriptions, partner AP deferred) and PA-L05 is DEFERRED.

The blockers that remain are **business and legal, not code defects**:

| Blocker | Gate | Effect today |
| --- | --- | --- |
| No licensed provider adapter (PHASE 30) | `PRODUCTION_ROUTING_AVAILABLE` | Production quotes nothing |
| Execution/settlement not licensed (PHASE 33) | `EXECUTION_ENABLED`, `PRODUCTION_EXECUTION_AVAILABLE` | `POST /executions` is 501 |
| No confirmed billing legal entity, tax position, or processor (PHASE 35) | `BILLING_LIVE_ENABLED` | Invoices are record-only; ops collect routes 403 |
| No subscription/payout infrastructure (PHASE 36) | — | No plan catalog, no AP ledger |
| Per-corridor legal sign-off absent | `LiveEnablement` rows (`approvedBy`, `licenseBasis`, `approvedAt`, `expiresAt`, `checklistRef`) | Every corridor stays sandbox; expired rows auto fail-close |
| No live execution partner adapter | `PARTNER_LIVE_ENABLED` | Sandbox mocks only |

`GO_LIVE_CHECKLIST.md` additionally requires six shared legal premises plus per-corridor sections
(USD↔KRW, EUR↔KRW, USD↔EUR, USD↔JPY, USD↔GBP) before any live row, and states that `fundsMoved`,
`custody`, `transferSigned`, and `meridianKeysUsed` must remain false — it does not authorize custody
or principal execution.

---

## 11. Current technical debt

### 11.1 Not implemented by design (legal/business gated)

Licensed partner quoting (PHASE 30) · lifting the execution 501 (PHASE 33) · fee collection, tax,
confirmed issuer entity (PHASE 35) · subscriptions and partner payouts (PHASE 36) · agent-to-agent
payments, treasury-as-product, KYC/sanctions as a product (PA-L05) · agent treasury envelopes
(PHASE 37, design only).

### 11.2 Product surface gaps

- `treasury_product` rail declared, no adapter.
- `defi`/`dex_liquidity` family filter still `planned` on `/comparisons` (returns 400).
- Composed route D (USD → stablecoin → DEX → KRW) declared planned, never composed.
- Chain registry rows for Base, Sepolia, Solana are `planned`, `connected: false`, `rpcUrl: null`.
- USDT→KRW off-ramp unsupported.
- No KYB vendor webhook; KYB approve/reject is manual only.

### 11.3 Identity and agent gaps

- Agent scopes are fixed at issue (`DEFAULT_AGENT_SCOPES`); operators cannot mint a quote-only
  `mag_` key.
- No rotate-in-place for agent or organization secrets — revoke and reissue only.
- Agent credentials are issued with `expiresAt: null`.
- An `AgentWalletReference` is always created on agent mint; making it optional was deferred
  (PA-M14).
- Login binds to the **first** membership, so multi-org users cannot choose an organization.
- SCIM and SAML are out of scope; OIDC does not run the MFA gate.
- Invite tokens use unsalted SHA-256 while sessions/keys use HMAC/scrypt.
- Legacy SHA-256 session and API-key hashes are accepted until 2026-11-28, then upgraded in place.
- `docs/DATABASE.md` and code comments name Argon2id as the intended password hash; runtime is
  scrypt.

### 11.4 Platform and operational

- No queue, no Redis, no cross-process quote cache; quotes are fetched per request.
- No distributed tracing (request ids in logs only), no in-repo Sentry/Datadog.
- The API sets HSTS when production-locked but registers **no helmet-equivalent**: no CSP, no
  `X-Frame-Options`, no `X-Content-Type-Options` at the API layer.
- One global rate-limit bucket; no per-route or per-key tier for auth or expensive quote endpoints.
- OpenAPI bodies reference a generic `JsonObject` rather than per-route schemas.
- `apps/web` duplicates the wire contract in `src/lib/api/types.ts` instead of importing from
  `@meridian/core`, so drift is possible.
- Prisma's `deepmerge-ts` advisory is handled by a root `overrides` pin.
- Fastify `trustProxy` is not explicitly configured, so anonymous rate-limit keys derive from
  `request.ip`.

### 11.5 UI debt

- `route-explorer.tsx` and `revenue-report.tsx` contain hardcoded English strings outside the
  next-intl catalogs; terms/privacy body copy is also literal.
- A `.dark` variant is fully defined in `globals.css` and used via `dark:` utilities, but nothing
  ever adds `.dark` to `<html>` — **there is no working theme toggle**.
- The dashboard has no Audit, Compliance, Settlement, Liquidity, Financial Intents, or Organizations
  page; Routes and API surfaces are not in the dashboard nav.
- The home comparison results do not render the send amount, score components, liquidity, or the
  `bestExecution` rationale even though the API returns them.

---

## 12. Risks observed during this inspection

Items below were noticed while reading code for this document. They are **observations pending
triage**, not agreed findings, and several are intentional sandbox-scoped decisions. None has been
changed.

| # | Observation | Where | Why it matters |
| --- | --- | --- | --- |
| R1 | `POST /api/v1/partner-webhooks/:partnerId` is **unauthenticated with no signature, timestamp, or replay protection**, and resolves the instruction via `findByIdAnyTenant` by `executionRef`. | `apps/api/src/routes/partner-instructions.ts:91` | Anyone knowing a partner id and an `executionRef` can drive instruction state. Currently sandbox-only (`assertNotLive`), so the blast radius is mock data — but this is the exact endpoint shape that must be hardened *before* any live partner. |
| R2 | `complianceOf()` always sets `eligible: true`. | `packages/core/src/engine/routing-cost.ts:572` | The compliance score can never zero out a route, so the `compliance` weight is effectively a licensing-tier bonus rather than a gate. |
| R3 | Sandbox compliance outcome is **caller-supplied** and an omitted value defaults to `'pass'`. | `packages/core/src/engine/execution-compliance.ts:13` | Correct for a sandbox simulator; would be a fail-open default if this function were ever reused on a real path. |
| R4 | No `policyVersion` anywhere; `PaymentPolicy` is one mutable row per agent with no history. | `prisma/schema.prisma:725` | A past policy decision cannot be explained by the policy text that applied at the time. This is an auditability gap that grows with every retained decision. |
| R5 | `AuditLog` has no `actorType`, `correlationId`, `before`/`after`, `reason`, or `policyVersion` columns — those live inside `payload` JSON per event type. | `prisma/schema.prisma:1356` | Querying "every decision by agents last month" or joining a lifecycle end-to-end requires JSON traversal. |
| R6 | Cookie `Secure` is derived from `PLATFORM_MODE`/`NODE_ENV`/`COOKIE_SECURE` and never from `X-Forwarded-Proto`; the API's HSTS decision likewise ignores forwarded protocol. | `apps/web/src/lib/session-cookie.ts:25`, `apps/api/src/app.ts:108` | Safe given the current explicit env contract, but a TLS-terminating proxy with a misconfigured env would silently drop `Secure`. |
| R7 | No CSRF token mechanism. Protection rests on `SameSite=Lax` + the cookie never being sent to the API + Next.js server-action origin checks. | repo-wide (no `csrf` symbol) | Adequate for the current topology; becomes load-bearing to re-verify if a browser client ever calls the API directly. |
| R8 | Rate limiting is a single global bucket, so a login brute-force and a quote flood share one budget, and anonymous callers are keyed on `request.ip` without `trustProxy` set. | `apps/api/src/http/rate-limit.ts:28` | Auth endpoints have no dedicated tier. |
| R9 | Invite tokens are hashed with unsalted SHA-256. | `apps/api/src/routes/onboarding.ts:155` | Inconsistent with the HMAC/scrypt used for every other credential. Short-lived tokens, so severity is low. |
| R10 | Ops operator auth is a single shared static header secret with no rotation workflow, no IP allowlist, and no per-operator identity. | `apps/api/src/onboarding/operator.ts:17` | Kill switches, the credential vault, live-enablement rows, and billing runs all sit behind this one secret, and audit rows cannot attribute an individual. |
| R11 | Agent credentials are minted with `expiresAt: null` and cannot be rotated in place. | `apps/api/src/routes/agent-payments.ts:113` | Non-expiring machine credentials for the highest-privilege scope set (`payment:*`). |
| R12 | `route-explorer.tsx` and `revenue-report.tsx` bypass next-intl. | `apps/web/src/components/*` | Any UI work touching those files will show English to `/ko` and `/ja` users. Relevant to the launch UI step. |

---

## 13. Verification surface

| Layer | Detail |
| --- | --- |
| Unit/integration | Vitest 3.2.4, **142** `*.test.ts` files co-located with source, ~1,200 cases; root config fans out to 5 workspace projects |
| E2E | Playwright 1.62.1, **8** specs / **55** cases, projects `api` / `web` / `mobile`, on dedicated ports |
| Invariant guards | `custody-guardrail.test.ts` (schema may not grow custody shapes), `executions.test.ts` (501 + audit), `production-gates.test.ts` (PA-C01), `env.test.ts` (PA-C02/C03 fail-close), `tenant-isolation.test.ts`, `execution-orchestration-custody.test.ts`, `policy-hardening.test.ts`, `quote-freshness-selection.test.ts`, `rate-limit.test.ts`, `openapi.test.ts` + `api-surface.test.ts` (spec coverage), `ci-hardening.test.ts` (CI/Dockerfile still enforce the gates) |
| Scripts | `npm run verify` = lint → typecheck → test; `test:e2e`, `test:e2e:postgres`, `i18n:check`, `audit:deps`, `test:staging-smoke` |
| CI (`.github/workflows/ci.yml`) | Five jobs, none `continue-on-error`: `verify` (with Postgres service), `e2e`, `e2e-postgres`, `container` (builds `--target api` and scans image history for demo secrets), `staging` (compose up, migrate, health, smoke). All five gate `main`. |
| Deploy | Multi-stage `Dockerfile` (build → migrate → pruned → api) running as non-root `meridian`, with fail-closed ENV baked in (`PLATFORM_MODE=production`, `DATABASE_DRIVER=postgres`, `PRODUCTION_*=false`, `SEED_DEMO_TENANTS=false`) and secrets injected at runtime; `docker-compose.staging.yml` (Postgres 16 + migrate + api); `scripts/run-local-staging.sh` with an explicit `fail-closed` assertion command |
| i18n | next-intl, 8 locales (`en` canonical and unprefixed, `ko`, `ja`, `zh-CN`, `es`, `fr`, `de`, `pt-BR`), **452** keys each, parity enforced by `apps/web/scripts/i18n-check.mjs` |

---

## 14. Summary

SELVO today is a **deterministic, non-custodial quote-and-rank engine** with production-grade
supporting infrastructure: tenancy, five credential kinds, scope-based RBAC, immutable audit,
reproducible comparison snapshots, exact decimal money, fail-closed policy evaluation, and CI that
regression-tests its own safety gates.

The gap to "AI Financial Orchestration Infrastructure" is **not** the safety architecture — that is
the strongest part of the system and the target design's central requirement ("AI must never bypass
deterministic authorization") is already structurally satisfied. The gaps are:

1. **No real AI layer** — the "AI" is a regex parser, so the untrusted-model-input boundary the
   target design needs does not exist yet.
2. **No tokenized-asset concept** at any layer.
3. **No generic settlement abstraction** — only a sandbox partner mock; "finality" means a mock said
   so.
4. **No unified authorization-decision record and no policy versioning**, so lifecycle
   explainability is limited to audit JSON.
5. **No human approval workflow** — consent flags exist, queues and statuses do not.
6. **Two platform modes, not four**, with DEMO/SIMULATION/PARTNER_SANDBOX expressed on other axes.
7. **No revenue collection path and no pricing surface** — invoices are record-only by legal gate.
8. **A UI that renders less than the API returns** and lacks the operational pages
   (Audit, Compliance, Settlement, Liquidity, Intents) the command-center target describes.

Sequencing for the target state is in `SELVO_ARCHITECTURE_TARGET.md`.
