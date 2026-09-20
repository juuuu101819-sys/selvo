# MERIDIAN — CANONICAL SPECIFICATION

### AI Financial Orchestration Infrastructure — the document the code's §-references resolve to

> **What this file is.** Code comments, documentation, and the Prisma schema reference this
> specification 219 times across 34 sections (§1–§28.3). This is that specification. It is a
> **descriptive reference** — it states what Meridian is and what each numbered section means,
> so that a comment reading "Pricing-shape flags (§18.3)" resolves to an openable definition.
>
> **Stable-contract rule.** The section numbers here are a contract. Do **not** renumber a
> section without updating every reference to it. New material is added as new numbers, never
> by shifting existing ones.
>
> **Source-of-truth rule.** The running code, schema, migrations, and config are the source of
> truth for _what the software does_; where this document and the code disagree on an
> implementation fact, the code wins and this document is corrected. This document is **not** a
> source of legal permission: never infer regulatory permission from implementation. Actual
> concrete values (flag defaults, etc.) are authoritative in code (e.g.
> `apps/api/src/config/env.ts`), not restated as doc-owned truth here.
>
> **Naming.** The product is **Meridian**. Code symbols, package names (`@meridian/*`),
> persisted credential prefixes (`mds_`, `mk_`, `mag_`), and the `meridian_session` cookie are
> wire contract and persisted data — they are not cosmetic and are never renamed.

---

## §0. OVERVIEW (not referenced; orientation only)

Meridian is an AI-driven, **non-custodial financial orchestration layer**. It interprets a
financial intent, discovers and compares routes across financial rails, normalizes quotes,
evaluates compliance and liquidity constraints, determines best execution, produces a
**signed execution intent**, and coordinates **regulated external providers** — while never
holding customer funds or keys and never transmitting on a customer's behalf in production.
Its revenue comes from the orchestration layer (usage, subscription, API, enterprise), with
transaction-based pricing available only behind explicit, documented gates.

---

## §1. IDENTITY

**Meridian IS:** a non-custodial orchestration layer · decision infrastructure · financial
route graph · quote-normalization layer · compliance-intelligence layer · best-execution
engine · AI financial-intent layer · provider-aggregation layer · settlement-orchestration
(coordination) layer · reconciliation layer · B2B API · infrastructure SaaS.

**Meridian IS NOT (initially):** a bank · payment institution · custodian · wallet provider ·
stablecoin issuer · DEX · securities broker/dealer · exchange/venue · asset manager · direct
settlement institution · an entity holding customer funds or controlling customer keys · a
company whose business is selling AI agents · a company that directly moves customer money.

Canonical flow:

```
AI Financial Intent → Intent Normalization → Provider Discovery → Quote Collection →
Quote Normalization → Risk/Compliance → Liquidity Analysis → Best Execution →
Route Selection → Deterministic Policy/Authorization Gate → Execution Intent →
[BOUNDARY] → External Licensed Provider → Settlement → Reconciliation → Audit
```

Everything left of `[BOUNDARY]` is Meridian software; everything right is a licensed partner.

---

## §2. EXECUTION BOUNDARY — PATTERN A/B ONLY, PATTERN C FAIL-CLOSED

The regulatory trigger is **not** "does Meridian hold funds." Initiating or transmitting an
order on the customer's behalf is a licensed activity even with zero custody. Meridian
operates only in Pattern A or B; Pattern C is fail-closed in production.

- **Pattern A — pure software (default):** Meridian computes the decision and returns a
  **signable execution-intent object** to the customer, who initiates through their own
  provider relationship. Meridian never transmits on the customer's behalf.
- **Pattern B — technology provider to a licensed partner:** the licensed partner runs
  Meridian's software; the customer contract and the initiation are the partner's.
- **Pattern C — customer-facing initiator (FAIL-CLOSED):** Meridian contracts the customer and
  transmits on their behalf. A licensed activity; disabled in production until §18.4's gate.

Any path that would send/initiate/transmit a real instruction on a customer's behalf is
Pattern C and stays fail-closed / 501 / flag-gated.

---

## §3. FUNCTIONAL SEPARATION ≠ CORPORATE SEPARATION

AI Agent, Tokenization, and Settlement Orchestration are **functional modules of one Meridian
platform**, not separate legal entities. A separate regulated entity is considered only on a
concrete trigger (a directly-performed regulated activity, capital requirements, ring-fencing,
liability isolation, jurisdiction-mandated local entity, or partner/investor demand) — never
merely because a module exists.

---

## §4. THREE-LAYER SAFETY ARCHITECTURE

```
LAYER 1  AI / Intent / Orchestration            (probabilistic — may propose only)
LAYER 2  Deterministic Control / Authorization  (deterministic — the source of truth)
         / Compliance / Policy
LAYER 3  External Financial Execution / Settlement (licensed partners only)
```

Layer 1 may only propose and can never write financial truth or bypass Layer 2. Layer 2 is
the deterministic backend and single source of financial truth. Layer 3 is always external.
This is enforced in code and permissions; it is **not** three companies.

---

## §5. ENGINEERING INVARIANTS

- **Money math:** `Decimal` / `bigint` / integer minor units only. Never floating point for
  any financial value (quotes, fees, FX, revenue, aggregation, analytics).
- **Adapters only:** no provider-specific logic in the core; the core stays provider-neutral.
- **Fail closed:** on any ambiguity, error, or timeout — deny/hold, never assume success.
- **No fabrication (AI or code):** never invent rates, fees, balances, liquidity, settlement
  status, provider credentials, licenses, or historical data. The deterministic backend is the
  source of truth; the AI only interprets/creates intent.
- **Audit everything; enforce organization isolation** on every read/write.
- **Backwards compatible:** `/api/v1/*` stable; migrations non-breaking; no duplicate models.

---

## §6. EXECUTION MODES

`DEMO · SIMULATION · PARTNER_SANDBOX · PRODUCTION`, never mixed. Production rejects demo/
simulated providers and requires a licensed-partner adapter, verified provider, production
credentials, compliance configuration, authorization, and policy approval. Transaction pricing
(§18) may run freely in SIMULATION/SANDBOX; in PRODUCTION it is flag-gated.

---

## §7. FINANCIAL RAIL ABSTRACTION

Common interfaces: `FinancialRail`, `FinancialProvider`, `ProviderCapability`,
`ProviderQuote`, `ProviderRoute`, `ProviderExecutionCapability`, `SettlementCapability`,
`ComplianceCapability`, `LiquidityCapability`. Every provider exposes normalized metadata
(`providerId, railType, jurisdiction, supportedCurrencies, supportedAssets, supportedChains,
supportedSettlementMethods, supportedTransactionTypes, fees, spreads, limits, settlementTime,
liquidity, reliability, complianceRequirements, availability, status`). Rail categories
(via adapters): TradFi · Stablecoin · Blockchain/DeFi · Tokenized Assets (§17, data/routing
only).

---

## §8. UNIVERSAL QUOTE ENGINE

One normalized quote model across all rails, covering source/destination asset and amount;
provider/platform/network/gas fees, spread, slippage, conversion/compliance/settlement cost;
`totalCost`, `effectiveRate`; estimated/guaranteed settlement time; liquidity, success
probability, provider reliability; and quote/expiration timestamps. Quote freshness is tracked;
expired quotes are unusable. Decimal-safe throughout.

---

## §9. CROSS-RAIL ROUTING & ROUTE GRAPH

A persistent cross-rail graph. Nodes: `FIAT, STABLECOIN, CRYPTO_ASSET, BANK, FX_PROVIDER,
PAYMENT_PROVIDER, DEX, AMM, LIQUIDITY_POOL, SETTLEMENT_PROVIDER` (authoritative closed set in
`packages/core/src/graph/types.ts:18-29`). Relationships: `CAN_CONVERT, CAN_TRANSFER, CAN_SETTLE, CAN_ROUTE,
HAS_LIQUIDITY, SUPPORTED_BY, AVAILABLE_IN, REQUIRES_COMPLIANCE`. The router computes total
economic cost, settlement speed, liquidity, success probability, provider reliability,
compliance and jurisdiction eligibility, and execution risk, then a `BestExecutionScore`
(§10). It does not optimize on price alone. The accumulating graph + outcome history is a core
moat; its data is never fabricated.

---

## §10. BEST EXECUTION ENGINE

Scores routes on the weighted factors above and returns a ranked, explainable recommendation
(why the top route ranked first). Best Execution **recommends**; it does not execute.

---

## §11. COMPLIANCE / RISK INTELLIGENCE

Meridian produces compliance **intelligence** — screening signals, jurisdiction analysis,
provider eligibility, risk scoring, transaction-monitoring signals, pre-checks. The
obliged-entity / legally-official KYC/AML decision of record remains with the licensed
partner. Meridian supplies decision support; it is never the regulated compliance authority of
record. Never bypass compliance; fail closed on uncertainty → exception queue (§20).

---

## §12. LIQUIDITY INTELLIGENCE

Liquidity discovery, depth/quality analysis, and prediction feeding route scoring and best
execution. Analysis and routing only — Meridian does not pool or custody liquidity.

---

## §13. AI FINANCIAL INTENT

Converts natural language into structured intent (source/destination currency, amount,
deadline, objective, priority). The AI must not invent rates, fees, balances, settlement
completion, liquidity, or regulatory status; it only creates/interprets intent, and Layer 2
(§4) is the truth.

---

## §14. AGENT POLICY / DETERMINISTIC AUTHORIZATION GATE

Every agent/user intent passes a deterministic gate before any execution-intent proceeds:
`maxTransactionAmount, dailyLimit, allowedRails, allowedProviders, allowedAssets,
allowedChains, allowedJurisdictions, maxFee, maxSlippage, minLiquidity,
requiredSettlementTime, recipientRules, approvalRules`. The AI cannot bypass these.

---

## §15. SETTLEMENT ORCHESTRATION — GENERATE-AND-RETURN ONLY

Meridian does not perform final settlement and (in Pattern A/B) does not transmit settlement
instructions on the customer's behalf. Abstractions: `SettlementRail, SettlementProvider,
SettlementInstruction, SettlementEvent, SettlementStatus, SettlementFinality,
ReconciliationRecord`.

`POST /api/v1/settlement/instructions` **creates and returns** a settlement-instruction
artifact (the signed execution/settlement intent, §15) for the customer to initiate, or for a licensed partner to
execute under Pattern B. It does **not** deliver/transmit that instruction to a provider on the
customer's behalf (that is Pattern C, gated). The stored settlement record carries no `status`,
`dispatched_at`, `submitted_at`, or `partner_instruction_id` column — there is no dispatch
state a code path could advance.

Statuses: `CREATED, AUTHORIZED, SUBMITTED, PROCESSING, CONFIRMED, FINALIZED, RECONCILED,
FAILED, EXCEPTION`. `COMPLETED` is not used unless a provider has confirmed final settlement;
`FINALIZED` requires provider-confirmed finality.

**Signature semantics.** The Ed25519 signature over an execution/settlement intent attests
"Meridian produced this recommendation, unaltered" — **not** "Meridian authorizes a fund
movement." The signed payload states this in its own fields; a JWKS endpoint publishes the
verification keys; `docs/SETTLEMENT_BOUNDARY.md` records the distinction and a doc-drift test
fails CI if the wording diverges from the code constants.

---

## §16. RECONCILIATION

Every transaction is reconcilable end-to-end: customer instruction · selected route · provider
instruction · provider tx ID · settlement event · fees · FX conversion · network fees · final
amount · timestamps · status · exceptions. Automated where possible.

---

## §17. TOKENIZED ASSET ABSTRACTION (DATA / ROUTING ONLY)

Meridian builds tokenized-asset registry, metadata, eligibility, provider/venue/issuer
discovery, quote comparison, liquidity analysis, compliance pre-check, settlement-route
selection, API, and reconciliation. It does **not** implement securities issuance, brokerage,
distribution, venue operation, investor custody, or regulated securities settlement — all
issuance/trading is `PARTNER_REQUIRED` and disabled in production until the required regulatory
structure exists. Tokenization as technology/data/routing ≠ regulated securities issuance or
brokerage.

---

## §18. MONETIZATION

Transaction-value monetization is supported **architecturally** but not activated in production
until legal/regulatory/contractual/partner requirements are satisfied. Regulatory status is
determined by Meridian's actual activities — custody, execution, initiation/transmission role,
intermediation, jurisdiction, contract structure — not by fee shape alone. **Fee shape ≠
regulatory status ≠ production activation ≠ revenue recognition.** These four are always kept
distinct.

### §18.1 — Usage/subscription is the primary monetization model

The default, launch-eligible model is subscription · SaaS · API usage (quote/route-search/
compliance/liquidity/settlement-status/reconciliation) · routing **API access** fee ·
enterprise contract, priced on usage/seats/tiers, not on transaction value.

### §18.2 — Revenue lifecycle (state machine); only realized may be reported as cash

```
QUOTED_REVENUE → EXPECTED_REVENUE → ATTRIBUTED_REVENUE → REALIZED_REVENUE
```

A single resolver decides state. `REALIZED_REVENUE` requires a **four-fact AND** —
PRODUCTION origin + provider-confirmed finality + collected recognition + processor reference —
each enforced by its own storage CHECK constraint; any missing fact caps the record at
`ATTRIBUTED` with a named reason. A non-PRODUCTION origin (DEMO/SIMULATION/PARTNER_SANDBOX) can
never reach REALIZED. QUOTED/EXPECTED/ATTRIBUTED are never represented as realized cash in DB,
API, dashboard, analytics, or investor-facing surfaces. Revenue recognition state is not the
same as bank/account cash.

### §18.3 — Pricing-shape flags (one per shape, split by regulatory risk)

Five shape flags, each guarding one pricing shape; a flag being off contributes zero and is
absent from customer-facing reporting (not merely un-paid-out):

- `FLAT_TXN_PRICING_ENABLED` — size-independent per-decision fee; lower structural complexity;
  the launch-eligible transaction shape. Its size-independence is proven by test (a $10 and a
  $10,000,000 decision are charged identically); scaling FLAT by size is a CI failure.
- `TIERED_TXN_PRICING_ENABLED` — size-banded fixed fee.
- `AD_VALOREM_PRICING_ENABLED` — % of notional; higher review requirement.
- `GAIN_SHARE_ENABLED` — performance/revenue share; highest review requirement; its
  computation, attribution, **and** dashboard display are all gated together.
- `TPV_PRICING_ENABLED` — volume-of-money; higher review requirement.

Defaults are authoritative in `apps/api/src/config/env.ts`, not restated here. The live
ad-valorem/markup path is moved **behind** its flag rather than deleted. All five may be freely
enabled in SIMULATION/SANDBOX for modeling.

### §18.4 — High-risk flags require a written legal opinion to flip

`AD_VALOREM_PRICING_ENABLED`, `GAIN_SHARE_ENABLED`, and `TPV_PRICING_ENABLED` cannot be set
true in production without a referenced `legalOpinionId` + jurisdiction (a `LiveEnablement`
record scoped to **that specific activity** — live execution ≠ ad-valorem pricing ≠ gain-share
≠ live collection). A flip without a matching active record is rejected at config load, not
silently ignored. The gate is a document, not a code default.

### §18.5 — Collection layer: both modes, live collection behind its own gate

Two collection modes behind `BILLING_LIVE_ENABLED` (default off): `RECORD_ONLY` (invoices
computed and recorded, no money collected — the pre-entity/pre-tax launch state) and `LIVE`
(a processor adapter collects). Live collection requires its own documented gate (entity
confirmed · tax/VAT confirmed · processor contracted). Raw card/bank credentials are never
stored; only a processor reference token. Collection attempts are idempotent (one key per
invoice-collection-attempt) so a retry cannot double-charge or double-record. Only the
processor's confirmed-success signal writes `recognition = 'collected'` and thereby allows
`REALIZED_REVENUE` (§18.2). "The API call did not error" is not collection.

### §18.6 — Billable-event taxonomy, no double-charge, cost disclosure

Billable events are disjoint — `SUBSCRIPTION_PERIOD`, `METERED_CALL`, `FLAT_DECISION` — so one
logical action maps to exactly one charge class; a test asserts no action produces two billable
events. Customer-facing cost is transparent: `Total = Provider Cost + Network Cost + Meridian
Orchestration Fee`, with no hidden multiple fees. Provider/network/Meridian/pass-through/
partner-commission/referral amounts are distinguished internally.

### §18.7 — Revenue stack (each behind the correct gate)

Routing (API access) · API usage · Enterprise SaaS · best-execution premium · FX/payment/
stablecoin/liquidity routing fees · compliance/data · settlement orchestration (coordination/
reconciliation/API) · tokenized-asset infrastructure · AI-agent API/transaction fees · partner
revenue · referral · reconciliation/data services. Revenue is recognized only when Meridian
provided the service or holds a valid contract. Revenue is never fabricated.

---

## §19. REVENUE ATTRIBUTION

Per transaction, a Decimal-safe attribution record across routing, fx, payment, stablecoin,
liquidity, defi, tokenization, compliance, settlement, reconciliation, api, subscription,
enterprise, referral, premiumExecution — each tagged with its §18.2 lifecycle state.
Ad-valorem/gain-share/take-rate fields compute in simulation/attribution but realize only when
the corresponding §18.3 flag is active **and** settlement is confirmed.

---

## §20. EXCEPTION MANAGEMENT

Normal path: `AI → policy → route → authorization → provider-return → settlement →
reconciliation`. Exceptions route to an **EXCEPTION QUEUE → HUMAN REVIEW → approve/reject** for
provider outage, compliance uncertainty, unusual transaction, liquidity shortage, expired
quote, settlement timeout, reconciliation mismatch, suspicious behavior, regulatory
uncertainty.

---

## §21. DASHBOARD & ANALYTICS

A financial command center: TPV (daily/weekly/monthly/YTD); revenue by type; economics (TPV,
revenue, provider cost, gross profit, gross margin, take rate, revenue/TPV); network
(providers, active rails, assets, chains, settlement success rate, avg settlement time);
routing (cheapest/fastest/best-execution/most-reliable). Decimal-safe aggregation only. Revenue
widgets show lifecycle state and never present expected/attributed as realized (§18.2).

---

## §22. API SURFACE

```
POST /api/v1/intents
POST /api/v1/quote
POST /api/v1/routes/search
POST /api/v1/best-execution
POST /api/v1/compliance/check
POST /api/v1/liquidity/search
POST /api/v1/settlement/instructions   # GENERATE & RETURN only (§15) — no delegated transmit
GET  /api/v1/settlement/:id
GET  /api/v1/reconciliation/:id
GET  /api/v1/providers  /rails  /assets  /currencies
GET  /api/v1/revenue                    # lifecycle-tagged; realized-only recognized
GET  /api/v1/analytics  /pricing
```

`POST /api/v1/executions` remains a safety gate / 501 (any real on-behalf initiation is Pattern
C, gated). Existing execution safety gates are never removed.

---

## §23. DATABASE (INSPECT, REUSE, DON'T DUPLICATE)

Inspect the current Prisma schema before adding. Reuse existing models where present
(`Provider, ProviderCapability, Currency, Route, Quote, QuoteLeg, TransactionRequest, Fee,
CustomerPricing, AuditLog`). New models only if absent. Migrations are non-breaking.

---

## §24. PHASED BUILD ORDER

Phases P1–P22, from repository inspection and architecture documentation, through the rail/
provider/quote/route/best-execution core, the revenue lifecycle + attribution and the pricing
flags (usage/subscription first, transaction-pricing flags off and gated), settlement
abstraction (generate-and-return), reconciliation, AI intent, agent policy, compliance,
liquidity, tokenized-asset abstraction, dashboard, enterprise API, security hardening, and
production audit. The transaction-value/take-rate machinery is built into the data model early
but its production activation is the last thing enabled, only after §18.4's gate; it is never
the center of gravity of the build. (A reordered sequence for a given phase is recorded where
that phase's work lives; this section is the ordering it refers to.)

---

## §25. PER-PHASE REPORT TEMPLATE

Each phase reports: implemented; files changed (the true per-phase diff, not the full-repo
snapshot); database changes; API changes; security changes; tests; monetization flags touched
(must match §18.3 defaults unless a §18.4 LiveEnablement record exists); execution/settlement
boundary impact (Pattern A/B/C); potential regulatory issue; remaining blocker; production
readiness. Production readiness is never claimed while a critical blocker is open.

---

## §26. ABSOLUTE RULES

**NEVER:** create custody · generate private keys · control wallets · hold/pool customer funds
· fabricate balances/quotes/credentials/licenses/settlement/finality/completion · bypass
compliance/authorization/agent-policy · use floating point for financial math · mix demo &
production providers · silently execute · transmit/initiate on a customer's behalf in
production (Pattern C) without §18.4 · remove execution safety gates · activate AD_VALOREM/
GAIN_SHARE/TPV pricing in production without a written legal opinion · represent expected/
attributed revenue as realized cash · surface transaction-value pricing in customer-facing/
contract/marketing before its flag is legitimately active · assume regulatory approval.

**ALWAYS:** deterministic backend as source of truth · Decimal/bigint · provider adapters ·
audit logs · organization isolation · enforce authorization/policy/compliance · track quote
freshness · track settlement state · track revenue attribution with lifecycle state · separate
simulation from production · fail closed · require licensed partners for regulated execution ·
keep Meridian in Pattern A/B by default.

---

## §27. FINAL PRINCIPLE

Meridian does not own the rails. It owns the **intelligence, routing, coordination and
orchestration layer** that connects them — and monetizes that layer safely. The strategic end
state is **one orchestration company + many functional modules + a deterministic control
boundary + licensed external execution/settlement partners** — the monetization and decision
layer above fragmented global financial rails. Build the layer that makes those institutions
interoperable; do not become the institutions.

---

## §28. WORKING METHOD

### §28.1 — Inspect first

Before modifying anything, inspect the repository read-only: Prisma schema, existing APIs,
routing/quote/monetization engines, AI-agent architecture, settlement and tokenization
abstractions, production audit.

### §28.2 — Reuse, don't duplicate

Identify existing functionality and do not re-implement it.

### §28.3 — Deliverable: architecture gap analysis

Produce an architecture **gap analysis** mapping current state → this specification, flagging:
(a) any code path that crosses the §2 boundary (Pattern C); (b) any monetization that is
transaction-value-based and not behind a §18.3 flag; (c) any revenue not lifecycle-tagged
(§18.2). Then implement incrementally per §24, reporting per §25. Do not rewrite the system;
begin with inspection and the gap analysis.

---

<!-- MERIDIAN_SPEC_CONTRACT — machine-checkable anchors (values authoritative in code) -->
<!--
SECTION_CONTRACT: §1–§28.3 (34 referenced sections). Section numbers are stable; do not renumber.
FLAG_NAMES (defaults live in apps/api/src/config/env.ts, not here):
  FLAT_TXN_PRICING_ENABLED, TIERED_TXN_PRICING_ENABLED, AD_VALOREM_PRICING_ENABLED,
  GAIN_SHARE_ENABLED, TPV_PRICING_ENABLED, BILLING_LIVE_ENABLED
REALIZED_FACTS (all four required, AND):
  PRODUCTION origin; provider-confirmed finality; collected recognition; processor reference
-->
