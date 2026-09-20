# SELVO — Target Architecture

**Status:** design record. Nothing in this document is implemented by writing it.
**Baseline:** `SELVO_ARCHITECTURE_CURRENT.md` (`main` @ `c8808df`)
**Purpose:** state the target end-state once, then split it into what ships for launch and what is
deliberately deferred — so that partner, investor and engineering conversations all read from the
same sequencing.

Two rules govern everything below.

**Rule 1 — the invariants are not negotiable by any item in this document.** Every target capability
inherits them:

- Non-custodial. SELVO never holds, generates, or controls customer fiat, crypto, stablecoins, or
  private keys, and never operates pooled customer funds.
- `POST /api/v1/executions` stays **501** until a licensed provider adapter exists and the
  `COMPLIANCE.md` gates are confirmed. Shipping a UI that describes the workflow does not lift it.
- Production gates default false: `EXECUTION_ENABLED`, `PARTNER_LIVE_ENABLED`,
  `BILLING_LIVE_ENABLED`, `PRODUCTION_EXECUTION_AVAILABLE`, `PRODUCTION_ROUTING_AVAILABLE`.
- Environment separation holds. No production → demo fallback, ever. Production fails closed on
  missing configuration.
- No fabricated numbers in production: no invented quotes, balances, rates, fees, liquidity,
  settlement completion, or compliance approval.
- Financial values use `Decimal`/`bigint`, never JS `number`.
- Secrets, private keys, and full credentials never reach logs.

**Rule 2 — extend, do not duplicate.** There is exactly one routing engine (`MultiRailRouter`), one
quote admission path, one policy engine, one audit log. A second engine, a parallel agent stack, or a
duplicate settlement model is a defect regardless of how well it works.

---

## 1. Target product definition

> SELVO is an AI Financial Orchestration Infrastructure that interprets financial intent and
> determines the optimal route across FX, payments, stablecoins, liquidity, tokenized assets and
> settlement rails, while applying compliance and deterministic authorization controls.

Target pipeline:

```
AI Financial Intent
  → Intent Normalization
  → Route Discovery
  → Quote Normalization
  → Compliance
  → Best Execution
  → Deterministic Authorization / Policy
  → Execution Intent
  → External Licensed Provider
  → Settlement
  → Reconciliation
  → Audit
```

The division of responsibility is the product's core claim:

| Layer | Owns |
| --- | --- |
| **AI** | Interpretation, intent drafting, explanation of deterministic facts |
| **Deterministic backend** | Amounts, currencies, rates, fees, balances, limits, provider capabilities, compliance results, authorization, execution state, settlement state, reconciliation, finality |

**AI never executes, and AI never produces a financial value that reaches a decision.** Model output
is untrusted input and must clear schema → semantic → business → policy → compliance validation
before it can become an `ExecutionIntent`.

The current codebase already satisfies this structurally (see
`SELVO_ARCHITECTURE_CURRENT.md` §7) — but only because the "AI" is a deterministic regex parser.
Introducing a real model introduces a trust boundary that does not exist today, and that boundary is
the single highest-risk change in this entire document.

---

## 2. Launch scope

These are the only items in scope before launch. Each is a separate change with its own commit,
deploy, and verification. Nothing here lifts a gate or weakens an invariant.

### 2.1 Comparison UI — total cost and routing rationale

**Goal:** a Wise-style all-in view plus a visible answer to "why is this route ranked first?"

Reuse `MultiRailRouter`, the existing comparison API, and the existing components. Build no new
engine and add no new endpoint.

Per route, surface in one card/row: send amount → receive amount, all-in total cost (fees + FX
spread), estimated settlement time, slippage, and route score. Expose the scoring weights and each
route's `scoreComponents` so the ranking is explainable from deterministic backend values. The API
already returns everything needed — `scoreComponents`, `bestExecution.rationale`,
`bestExecution.rationaleHash`, `constraintsSatisfied[]`, `sendAmount`, quote freshness — and the home
comparison currently renders none of the first four.

Data-provenance must be legible: distinguish LIVE / SIMULATION / DEMO visually *and* semantically,
keep the `Sandbox` badge and its meaning intact, and when production returns
`UNSUPPORTED_CORRIDOR` or `NO_ROUTES_AVAILABLE`, explain the reason plainly instead of showing an
empty result.

Constraints: preserve the 452-key next-intl parity across all 8 locales (`en.json` is canonical;
`route-explorer.tsx` and `revenue-report.tsx` are known hardcoded-English offenders), keep responsive
and dark-mode behaviour, and break no existing test.

### 2.2 Security hardening

**Procedure, not a patch:** report findings by severity first, get approval, then fix without
weakening any gate, then add regression tests.

Review scope: organization-scoped endpoints enforce authenticated user + org membership + required
role + resource ownership; no client-supplied `organizationId` is trusted alone; Zod at every
external boundary; IDOR, CSRF, rate-limit bypass, session over-privilege; secret/credential logging;
cookie attributes (`HttpOnly`, `SameSite`, `Secure` mandatory in production); and the role model
(VIEWER must not reach execution-adjacent actions; policy, credential, and settlement configuration
require appropriate roles).

The as-built posture and twelve pending observations are catalogued in
`SELVO_ARCHITECTURE_CURRENT.md` §4 and §12. R1 (unauthenticated partner webhook), R10 (single shared
ops secret), and R11 (non-expiring, non-rotatable agent credentials) are the strongest candidates to
raise first.

### 2.3 Pricing display only

Show four tiers driven by **usage and subscription**, never a percentage of transaction volume:
Free (monthly included calls, $0), Starter (subscription + included calls + per-call overage), Pro
(larger inclusion + volume-discounted overage), Enterprise (contact for quote). Copy must say
per-call / subscription explicitly.

`BILLING_LIVE_ENABLED` stays false. Invoices stay record-only. **No payment processor integration.**
Per-org API-call usage is not currently metered anywhere (`rate_limit_buckets` is a throttle, and
dashboard provider usage counts quotes) — if usage display requires a meter, document it as a TODO
rather than building one under launch pressure.

### 2.4 Demo-visibility decision

Production currently returns `UNSUPPORTED_CORRIDOR` for every corridor because the licensed registry
is empty by design. Two options, to be decided by environment variable by the product owner, not by
a code change:

- **(A) Keep production as-is.** No prices until licensing. Safest.
- **(B) Run a separate demo/sandbox deployment** with `PLATFORM_MODE=sandbox` so sandbox quotes are
  visible, with the `Sandbox` label retained and full separation from the production lock.

Option B's separation rests on three independent mechanisms already in the code — an empty
production provider list plus a `ConfigurationError` if `PRODUCTION_ROUTING_AVAILABLE=true`,
registry-level rejection of `unlicensed_sandbox` licensing in production mode, and
`includeDemoAdapters` hard-wired to `mode === 'sandbox'`. Choosing B must not touch any of them; it
is a second deployment with different env, not a relaxation of the first.

---

## 3. Deferred roadmap

Everything in this section is **explicitly out of launch scope**. It is recorded here so the target
is legible to partners and investors, and so that when each item is picked up it starts from a
written premise instead of a fresh guess. Each subsection states what exists today, so the delta is
honest.

### 3.1 Tokenized asset infrastructure

**Today:** nothing. Non-fiat assets are USDC, USDT, ETH. "Token" in the repo means an auth token.

**Target scope, in order:** registry → intelligence → routing → settlement abstraction.
Explicitly **not** unrestricted security-token issuance.

Entities: `TokenizedAsset`, `AssetIssuer`, `AssetClass`, `AssetJurisdiction`, `AssetChain`,
`AssetVenue`, `AssetLiquidity`, `AssetPrice`, `AssetEligibility`, `AssetComplianceProfile`,
`AssetSettlementMethod`. Classes: `TOKENIZED_BOND`, `TOKENIZED_FUND`, `TOKENIZED_EQUITY`,
`TOKENIZED_REAL_ESTATE`, `TOKENIZED_CREDIT`, `TOKENIZED_DEPOSIT`, `TOKENIZED_MMF`, `OTHER`.

Per asset: `assetId`, `symbol`, `name`, `assetType`, `issuerId`, `jurisdiction`, `chain`,
`contractReference`, `legalStatus`, `ownershipModel`, `currency`, `price`, `nav`, `liquidity`,
`settlementRail`, `eligibility`, `status`, `lastUpdatedAt`.

**Never assume a token is legally a security.** `LEGAL_CLASSIFICATION`, `REGULATORY_STATUS`,
`JURISDICTION`, and `ELIGIBILITY_STATUS` are explicit metadata, never inferred.

Routing: `FIAT`, `STABLECOIN`, and `TOKENIZED_ASSET` become node types in the **existing** route
graph (e.g. `USD → USDC → tokenized bond → settlement rail → KRW`). Note the current structural
limit: a priced route is one provider's single conversion, and multi-hop exists only in unpriced
graph discovery — so tokenized-asset routing depends on composed multi-leg pricing, which does not
exist yet.

Eligibility returns `ELIGIBLE | RESTRICTED | REQUIRES_REVIEW | INELIGIBLE | UNKNOWN` after checking
jurisdiction, investor eligibility, asset status, issuer status, venue status, settlement method,
allowed organization type, required KYC/KYB, and restrictions. **`UNKNOWN` is never treated as
`ELIGIBLE`.**

### 3.2 Settlement orchestration

**Today:** a sandbox `PartnerInstruction` (`accepted | settling | partial | settled | failed`) with
hash-only storage, partner-scoped HMAC signing, an eight-kind `ReconciliationEngine`, and Ed25519
receipts. "Finality" means a mock partner said so. No generic settlement model exists.

**Target entities:** `SettlementRail`, `SettlementProvider`, `SettlementInstruction`,
`SettlementAttempt`, `SettlementEvent`, `SettlementStatus`, `SettlementFinality`,
`ReconciliationRecord`.

Lifecycle: `CREATED → VALIDATED → AUTHORIZED → SUBMITTED → PROCESSING → CONFIRMED → RECONCILED`,
with `FAILED | CANCELLED | EXPIRED`. **`SETTLED`/`FINAL` may only be produced by a verified external
settlement provider, or by a deterministic simulation explicitly marked `SIMULATED`.** If finality
cannot be verified, it is not final. This mirrors the existing discipline in
`financial-status.ts`, which retired `AUTHORIZED`/`COMPLETED`/`EXECUTION_PENDING` precisely because
they read as settlement.

Rails: `BANK`, `PAYMENT_PROVIDER`, `CARD`, `STABLECOIN`, `BLOCKCHAIN`, `TOKENIZED_DEPOSIT`,
`TOKENIZED_ASSET`, `OTHER` — each with capabilities, currencies, assets, jurisdictions, settlement
time, finality model, provider, fees, status, availability.

`SettlementProviderAdapter` interface: `getCapabilities`, `createInstruction`, `submitInstruction`,
`getStatus`, `cancelInstruction`, `getFinality`, `reconcile`. Ship
`SimulationSettlementAdapter` and `ProductionSettlementAdapter` as distinct implementations;
production **fails closed** when unavailable and never falls back to simulation.

Reconciliation records expected vs actual amount, currency, counterparty and reference, plus
difference and status (`MATCHED | PARTIAL | MISMATCH | PENDING | FAILED`). **`MISMATCH` raises an
operational alert.**

Idempotency: every instruction carries an `idempotencyKey`, a request hash, a provider reference, an
internal reference, and an attempt number. Duplicate submission must not create a duplicate
instruction, and retries must be deterministic. The pattern already exists for
`OrchestratedExecution` (`@@unique([organizationId, idempotencyKey])` + payload fingerprint) and
should be reused rather than reinvented.

Webhooks from settlement providers require signature verification, timestamp validation, replay
protection, idempotency, a provider event id, and event-ordering handling — none of which the
current sandbox webhook has (see R1).

### 3.3 Agent infrastructure at scale

**Today:** `Agent` (`active | suspended | retired`), `AgentCredential` (`mag_`, scrypt, fixed
scopes), `AgentWalletReference` (external handle, `controlledByPlatform: false`), `PaymentPolicy`
(12 controls), `PaymentIntent` (9 statuses), mandates (AP2 intent/cart, x402, MPP), and a
fail-closed policy engine whose denial type is a thrown `PolicyDeniedError` over 15 rules.

**Target additions.** Reuse existing models — do not create parallel entities for things that exist:

| Target | Disposition |
| --- | --- |
| `FinancialAgent`, `AgentIdentity`, `AgentCredential`, `AgentPolicy` | Extend `Agent`, `AgentCredential`, `PaymentPolicy` |
| `FinancialIntent`, `IntentConstraint`, `IntentPlan` | New; `PaymentIntent` is the closest analogue but is agent-payment specific |
| `AgentMandate` | Extend `Mandate` |
| `ExecutionIntent` | Exists (`recorded` only) |
| `AgentAuditLog` | Extend `AuditLog`, do not fork it |

Lifecycle target `CREATED | ACTIVE | SUSPENDED | REVOKED | EXPIRED` versus today's three states.
Policy fields still absent: monthly limit, required settlement time, human-approval threshold, and
**policy versioning** (today one mutable row per agent, no history — see R4).

Credential handling target: never store plaintext (already true), hash secrets (already true),
support rotation (absent), revocation (present), expiration (column exists, always null on issue),
usage logging (present), and per-agent rate limiting (absent — one global bucket).

**Deterministic authorization gate.** Every `ExecutionIntent` should carry `intentId`, `agentId`,
`organizationId`, `policyVersion`, `policyDecision`, `complianceDecision`, `authorizationDecision`,
`decisionTimestamp`, `decisionReason`, `riskFlags`. Today there is no unified authorization record at
all; `POST /payment-intents/:id/authorize` is a policy re-check, and `policyVersion` and `riskFlags`
have no representation. Authorization must remain a step that AI cannot skip: policy → compliance →
authorization, with failure at any stage meaning **no execution and no pretence of execution**.

**Human-in-the-loop.** Target statuses `PENDING_APPROVAL | APPROVED | REJECTED | EXPIRED`, triggered
by configurable conditions (amount over threshold, HIGH compliance risk, new counterparty, new
provider, unclear tokenized-asset eligibility), with every approval audited. Today: two audited
owner/admin consent flags that record `functionalEffect: 'none'`, and a `COMPLIANCE_REVIEW` status
with no queue, UI, or release path.

**Multi-agent readiness.** Do not build an autonomous multi-agent system. Keep the architecture
compatible with future Treasury, Compliance, Routing, Liquidity, Settlement and Reconciliation
agents; for now a single Financial Orchestrator Agent coordinates deterministic backend services and
never calls a financial provider without passing the control gates.

### 3.4 Compliance engine

**Today:** caller-supplied sandbox outcome (`pass | deny | review`, defaulting to `pass` when
omitted), org-level manual KYB gating licensed quotes, policy jurisdiction allowlists, and route
compliance metadata. No sanctions screening, no automated KYC/KYB, no per-intent decision record, and
`complianceOf()` always returns `eligible: true` (R2).

**Target:** a `ComplianceDecision` of `PASS | REVIEW | FAIL | UNKNOWN` where **`UNKNOWN ≠ PASS**,
covering KYC/KYB status, jurisdiction, sanctions, restricted jurisdictions, asset restrictions,
provider restrictions, transaction limits, counterparty rules, agent policy, and tokenized-asset
eligibility. AI may classify or explain; the deterministic policy remains the final gate.

### 3.5 Best Execution 2.0

**Today:** seven weighted factors (cost, speed, fxRate, finality, slippage, liquidity, compliance),
min-max normalised, rail-health multiplied, with a `bestExecution` attestation including a
`rationaleHash`.

**Target additions:** counterparty risk (absent; `ProviderQuote.risk` exists but the multi-rail cost
engine ignores it), quote freshness as a scored input rather than only an admission gate, and
reliability plus historical success rate as first-class weighted factors rather than rail-health
inputs. Gas and spread are already inside the cost term and do not need separate weights unless
product requires the visibility.

Scoring stays deterministic. **AI may explain a score; AI must never produce one.**

### 3.6 Liquidity intelligence

**Today:** provider-disclosed depth → liquidity headroom → a score component plus rail-health
dry/thin deprioritization, and static graph edge liquidity.

**Target:** track provider, asset, chain, venue, available liquidity, depth, slippage estimate,
`lastUpdatedAt`, confidence, and status, with liquidity health, and with `REAL | PARTNER |
SIMULATED | DEMO` liquidity never mixed.

### 3.7 Corporate treasury

**SELVO's own corporate funds only. Never mixed with customer assets. Not an external
asset-management service.**

**Today:** no treasury models at all. `treasury_product` is a declared rail with no adapter.
`TREASURY_DESIGN.md` is design-only, explicitly rejects in-platform spendable balances, and has
unresolved open questions.

**Target entities:** `TreasuryAccount`, `TreasuryPosition`, `TreasuryAsset`, `TreasuryPolicy`,
`TreasuryTransaction`, `TreasuryAllocation`, over categories `CASH`, `BANK_DEPOSIT`,
`GOVERNMENT_BOND`, `CORPORATE_BOND`, `EQUITY`, `GOLD`, `REAL_ESTATE`, `INFRASTRUCTURE`, `OTHER`.
Policy supports max allocation, minimum cash, currency exposure, and asset/counterparty/jurisdiction/
maturity/risk limits.

**No autonomous investment execution.** First version is `ANALYSIS`, `RECOMMENDATION`, `SIMULATION`,
`APPROVAL` only. Note that any treasury balance model must be reconciled against the custody
guardrail test, which fails the build on balance-shaped schema additions — corporate treasury needs
an explicit, tested carve-out that cannot be reused for customer funds.

### 3.8 Billing collection

**Today:** nine revenue sources, four economic stages, `unrealized | invoiced | collected` (where
`collected` is never written), invoices with `taxCalculation: 'deferred'` and
`issuerLegalEntity: 'unconfirmed'`, a `DeferredPlatformFeeCollector` that deliberately does not
collect, and three ops billing routes that always return an audited 403.

**Target revenue types:** `API_USAGE`, `SUBSCRIPTION`, `ENTERPRISE`, `ROUTING_FEE`, `DATA`,
`COMPLIANCE`, `SETTLEMENT_ORCHESTRATION`, `TOKENIZED_ASSET_INFRASTRUCTURE`, `AGENT_USAGE`,
`PARTNER_REFERRAL`. Every revenue event identifies organization, product, transaction/intent where
applicable, provider, amount, currency, fee, status, timestamp.

**Demo and simulation revenue is never recorded as production revenue.** Gated behind
`BILLING_LIVE_ENABLED` plus the PHASE 35/36 legal prerequisites: confirmed issuer legal entity, tax
position, processor, subscription model, and payout model.

### 3.9 Command-center UI

**Today:** nine dashboard nav items (Overview, Quotes, Transactions, Providers, Revenue, Invoices,
Agents, Onboarding, Settings).

**Target navigation:** Dashboard, Financial Intents, AI Agents, Routes, Quotes, Liquidity, Tokenized
Assets, Settlement, Compliance, Providers, Transactions, Organizations, API, Billing, Audit,
Settings. Absent today: Financial Intents, Liquidity, Tokenized Assets, Settlement, Compliance,
Organizations, Audit; partial: Routes, API, Billing.

Dashboard target metrics: TPV, route volume, active intents, active agents, settlement status and
success rate, provider health, route performance, quote freshness, compliance alerts, API usage,
revenue, system status. **Every metric carries source, timestamp, currency/unit, and calculation
method**, and LIVE / SIMULATION / DEMO are visually and semantically inseparable from the number
they describe. No fake numbers in production.

**Financial Intent interface.** A first-class surface accepting either natural language ("Send USD
500,000 from US to Korea") or structured fields: amount, source/destination currency, origin,
destination, purpose, deadline, max fee, max slippage, preferred rail, allowed providers, allowed
chains, counterparty, settlement requirement. Normalized into a `FinancialIntent` by deterministic
schema validation — **never by letting a model emit financial values directly.**

### 3.10 Environment model

**Today:** two platform modes (`sandbox | production`), with DEMO, SIMULATION and PARTNER_SANDBOX
expressed on unrelated axes (seed flags, intent statuses, partner kinds).

**Target:** explicit `DEMO | SIMULATION | PARTNER_SANDBOX | PRODUCTION` state on every capability,
with `DEMO_PROVIDER`, `SIMULATION_PROVIDER`, `PARTNER_PROVIDER` and `PRODUCTION_PROVIDER` as distinct
concepts, and records never mixed across environments. Migrating a two-value mode enum into a
four-value one touches the registry filters, the container, the Dockerfile ENV, the env schema,
`/meta`, and the production-gate tests — it is invasive and should be sequenced deliberately, not
bundled with a feature.

### 3.11 Platform hardening

API security target: rate limiting (per-route tiers, not one global bucket), request validation,
authentication, authorization, idempotency, request and correlation ids, and audit logs — with strict
authorization on `POST /execution-intents`, `POST /settlements`, `POST /agents`,
`PATCH /agents/:id/policy`, `POST /tokenized-assets`, `POST /providers`, `POST /credentials`.

Audit target adds `actorType`, `correlationId`, `before`/`after`, `reason`, and `policyVersion` as
first-class fields rather than JSON payload keys (R5), so a full lifecycle — agent → intent → plan →
quote → route → compliance → policy → authorization → execution intent → settlement instruction →
provider event → reconciliation — is queryable end to end.

Observability target: structured logging (present), metrics, health checks (present), plus provider,
settlement, agent, quote-freshness, route-failure, compliance-failure, authorization-failure and
reconciliation-mismatch health, with correlation ids spanning intent → route → execution →
settlement → reconciliation.

API versioning: keep existing routes backward compatible; new surfaces under `/api/v1`; reuse
equivalent endpoints rather than adding near-duplicates. Candidate paths — `/intents`, `/agents`,
`/agents/:id/policy`, `/agents/:id/credentials/rotate`, `/tokenized-assets`, `/settlement/rails`,
`/settlement/providers`, `/settlements`, `/settlements/:id/events`, `/reconciliation` — should each
be checked against the existing 106-route surface first.

Database: extend before adding. `User`, `Organization`, `Provider`, `Route`, `Quote`,
`TransactionRequest`, `AuditLog`, `Agent`, `PaymentPolicy`, `Mandate`, `ExecutionIntent` and
`MonetizationEvent` already exist. Financial values stay `Decimal(38, 0)` minor units with
`Decimal(38, 18)` rates, `bigint` for atomic integer units, and every amount carries explicit
currency and scale.

### 3.12 Jurisdiction and currency readiness

Design for jurisdiction-specific rules with **Korea as one jurisdiction among many** — `KR`, `US`,
`EU`, `UK`, `SG`, `HK`, `JP` — and implement legal rules for a jurisdiction only where reliable
source data exists. `GO_LIVE_CHECKLIST.md` already encodes Korea-specific 외국환/특금/전자금융 items
for KRW corridors; that is the pattern to generalise, not to hardcode.

Currency readiness for KRW, USD, EUR, GBP, JPY, SGD, HKD, AUD, CAD, CHF comes from currency metadata
(the `Currency` table plus `CURRENCY_REGISTRY` in core, which a test keeps in agreement), never from
currency-specific branches.

### 3.13 Legal and regulatory boundary

Make no legal claims in the application. Use status labels — `PARTNER_REQUIRED`,
`REGULATORY_REVIEW_REQUIRED`, `NOT_AVAILABLE`, `SIMULATION_ONLY`, `PRODUCTION_ENABLED`. Never label
an asset "legal", "approved", or "licensed" unless that status is backed by verified data. For
tokenized securities SELVO supplies infrastructure and metadata; issuance, trading and settlement
require a regulated structure and external partners.

---

## 4. Failure modes

Every target feature must degrade safely, consistent with how the system already behaves:

| Condition | Required behaviour |
| --- | --- |
| AI unavailable | Deterministic quote and route APIs stay fully usable. AI must never block the critical path. |
| Provider fails | Route marked unavailable. |
| Quote expires | Refresh required; no execution on a stale quote. |
| Compliance fails | Execution blocked. |
| Policy fails | Execution blocked. |
| Settlement provider fails | Status reflects failure. No invented progress. |
| Webhook invalid | Reject. |
| Database unavailable | No false success. |
| External API times out | No assumption of success. |
| Finality unverifiable | **Do not mark final.** |

---

## 5. Testing obligations

Beyond the existing 142 unit/integration files and 8 Playwright specs, target coverage adds: AI
intent parsing, schema validation, policy evaluation, authorization, organization isolation, role
permissions, agent credential rotation and revocation, tokenized-asset eligibility, settlement
lifecycle and retry, idempotency and duplicate requests, webhook verification, reconciliation, quote
expiry, route scoring, provider outage, compliance failure, simulation/live separation, and
production configuration.

Three tests are non-negotiable and should be written before the features they guard:

1. **AI can never bypass deterministic authorization.**
2. **SIMULATION never appears as PRODUCTION.**
3. **Settlement cannot become FINAL without a valid finality source.**

The existing guardrail pattern is the model to follow — `custody-guardrail.test.ts` fails the build
if the schema grows a custody shape, and `ci-hardening.test.ts` fails if CI or the Dockerfile stops
enforcing the production gates. New invariants should be enforced the same way: by a test that breaks
when someone removes the protection, not by a comment asking them not to.

---

## 6. Target architecture

```
                    AI AGENTS
                        │
                        ▼
                FINANCIAL INTENT
                        │
                        ▼
              INTENT NORMALIZATION
                        │
                        ▼
              SELVO ORCHESTRATOR
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
       FX           PAYMENT          STABLECOIN
        │               │                │
        └───────────────┼────────────────┘
                        ▼
                    LIQUIDITY
                        │
                        ▼
                TOKENIZED ASSETS
                        │
                        ▼
                   COMPLIANCE
                        │
                        ▼
                 BEST EXECUTION
                        │
                        ▼
              DETERMINISTIC POLICY
                        │
                        ▼
                  AUTHORIZATION
                        │
                        ▼
                EXECUTION INTENT
                        │
                        ▼
              EXTERNAL PROVIDERS
                        │
                        ▼
                   SETTLEMENT
                        │
                        ▼
                 RECONCILIATION
                        │
                        ▼
                      AUDIT
```

Internal, strictly separated from customer flow:

```
SELVO PROFIT
     ↓
CORPORATE TREASURY
     ↓
CASH / BONDS / EQUITIES / GOLD / REAL ESTATE / INFRASTRUCTURE
```

### 6.1 Distance from here to there

| Layer | State |
| --- | --- |
| Intent normalization | Deterministic parser exists; no `FinancialIntent` entity or UI |
| Orchestrator | `MultiRailRouter` exists and is the single ranking engine |
| FX / payment / stablecoin | Quoted today, from datasets — no licensed adapter |
| Liquidity | Provider-disclosed depth only; no liquidity intelligence model |
| Tokenized assets | **Nothing** |
| Compliance | Manual KYB + metadata; caller-supplied sandbox outcome; no `UNKNOWN` |
| Best execution | 7 deterministic factors with a hashed attestation — closest to target |
| Deterministic policy | Fail-closed, 15 rules, no versioning |
| Authorization | No unified decision record |
| Execution intent | Exists, `recorded` only, `executable`/`submitted` pinned false |
| External providers | Sandbox mocks only |
| Settlement | Sandbox partner instruction; no generic rail/provider/instruction model |
| Reconciliation | 8 mismatch kinds against mock partner data |
| Audit | 83 event types, append-only by trigger; thin first-class columns |
| Corporate treasury | **Nothing** (design doc only) |

The safety architecture is the asset. The missing pieces are capability surface — and the invariants
in Rule 1 are what make it safe to build them incrementally rather than all at once.
