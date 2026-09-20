# SELVO — Architecture Gap Analysis

**Deliverable for:** canonical implementation spec §28.3 ("produce an architecture gap analysis
mapping current state → this spec").
**Baseline:** `main` @ `0417668`. No code was changed to produce this document.
**Companions:** `SELVO_ARCHITECTURE_CURRENT.md` (as-built inventory, spec §24 P1),
`SELVO_ARCHITECTURE_TARGET.md` (target state, spec §24 P2).
**Naming:** brand is SELVO; every code symbol says `Meridian`. No rename is proposed —
credential prefixes (`mds_`, `mk_`, `mag_`) and the `meridian_session` cookie are persisted data
and wire contract.

---

## 0. Verdict

The existing system is **already Pattern A/B-shaped in its runtime behaviour** and already carries
most of the spec's invariant discipline: exact-decimal money with `number` rejected at the type
level, fail-closed policy evaluation, append-only audit with a database trigger, organization
isolation, adapter-only provider logic, and CI that regression-tests its own safety gates. Spec §5
and §26 are, for the most part, satisfied rather than aspirational.

Three findings change the build order the spec proposes.

**Finding 1 — the risk ordering is currently inverted.** Spec §18 says the safe monetization
(subscription / API usage) ships first and ad-valorem is the *last* thing enabled. In this
repository the opposite is already true: **ad-valorem pricing (`markupBps`, `surchargeBps`) is
fully implemented and runs in production**, gated only by the existence of a `CustomerPricing` row,
while **per-API-call usage metering — the spec's safe default — does not exist at all.** The
high-risk pricing shape is built; the low-risk one is not.

**Finding 2 — two Pattern C-shaped code paths exist.** `POST /api/v1/partner-instructions`
accepts a customer-signed instruction and calls `dispatchInstruction` on the customer's behalf, and
`POST /api/v1/executions` reaches the same dispatch through orchestration. Both are blocked in
production by several independent gates and both terminate in an in-process mock with no outbound
network call, so **neither is exploitable today**. But the *shape* is Pattern C, and spec §15
requires the settlement-instruction endpoint to generate-and-return only. The endpoint that exists
is dispatch-shaped, not return-shaped.

**Finding 3 — "realized revenue" has three conflicting definitions.** The CHECK constraint the spec
asks us to reuse does exist and is correct. But the dashboard's `realizedRevenueMinorUnits` is
computed from `economicStage === 'settled'`, which in sandbox means *a mock partner said so* — so
running a sandbox orchestration inflates a field named "realized revenue". Meanwhile
`realizedRevenue` is hardcoded `false` on every read and `revenueRecognition: 'collected'` is never
written, making the constraint inert in the application layer.

Nothing above requires a rewrite. All three are contained, and the correct first implementation
phases follow from them (§6).

---

## 1. §28.3(a) — Pattern C boundary audit

Spec §2 defines the regulatory trigger as **initiating or transmitting an order on the customer's
behalf**, which is licensed activity in many jurisdictions (EU PISP, MiFID reception-and-transmission
of orders) *even when no funds are held and no money moves*. Every path below was assessed against
that definition, not against custody.

### 1.1 Outbound network surface

**No provider or partner adapter in this repository makes a real outbound network call.** Every
quote adapter and the sole execution-partner adapter resolve in-process. The complete set of real
`fetch` calls in the backend is three, all OIDC:

| File:line | Call | Classification |
| --- | --- | --- |
| `apps/api/src/auth/oidc-client.ts:62` | OIDC token endpoint | Auth, not financial |
| `apps/api/src/auth/oidc-client.ts:126` | OIDC discovery | Auth, not financial |
| `apps/api/src/auth/oidc-client.ts:92` | Remote JWKS | Auth, not financial |

`packages/adapters/src/resilience/execute.ts` documents how a *future* network adapter should pass
an `AbortSignal` to `fetch` — the extension point is designed but unused.

### 1.2 Pattern C-shaped paths

| # | Path | Entry | Gates | Outbound today | Reachable in production |
| --- | --- | --- | --- | --- | --- |
| C1 | Partner instruction dispatch | `POST /api/v1/partner-instructions` → `PartnerInstructionService.dispatch` → `ExecutionPartner.dispatchInstruction` | `assertSandboxDispatch` (mode must be sandbox), `assertNotLive`, registry excludes `kind:'live'` unconditionally | No — in-process `Map` | **No** |
| C2 | Orchestrated dispatch | `POST /api/v1/executions` → `ExecutionOrchestrationService.dispatchAndSettle` → C1 | `EXECUTION_ENABLED=false` → **501**; `assertEnabled` requires sandbox; env schema rejects the flag when production-locked | No | **No** |
| C3 | Partner status polling | `GET /partner-instructions/:id`, orchestration `pollPartner` | Same as C1/C2 | No | **No** |
| C4 | Hypothetical live adapter | `ExecutionPartner.dispatchInstruction` | `PARTNER_LIVE_ENABLED`, *plus* the registry refusing live even when that flag is true, *plus* no live adapter existing | N/A | **No** |

The decisive guards:

```ts
// packages/core/src/engine/partner-instruction-service.ts:359
private assertSandboxDispatch(): void {
  if (!this.deps.sandboxMode) {
    throw new ForbiddenError('Execution-partner dispatch is sandbox-only.', {
      failClosed: true, reason: 'production_dispatch_disabled', flag: 'PARTNER_LIVE_ENABLED',
    });
  }
}
```

```ts
// packages/core/src/engine/execution-partner-registry.ts:60
if (partner.kind === 'live' || partner.capabilities.live || partner.capabilities.kind === 'live') {
  if (!options.liveEnabled) {
    exclusions.push({ partnerId: id, reason: 'live execution partners are disabled (PARTNER_LIVE_ENABLED=false)' });
    continue;
  }
  exclusions.push({ partnerId: id, reason: 'live execution partners are not implemented' });
  continue;
}
```

Note the second branch: even with `PARTNER_LIVE_ENABLED=true`, a live partner is still excluded.
That is a genuine belt-and-braces design and should be preserved.

### 1.3 Findings

| ID | Severity | Finding |
| --- | --- | --- |
| **PC-01** | **High (shape, not exploitability)** | `POST /api/v1/partner-instructions` is a **dispatch** endpoint: it accepts a customer-signed instruction and forwards it to a partner adapter on the customer's behalf. Spec §15 requires the settlement-instruction endpoint to **create and return** an instruction object and explicitly **not** deliver it. The existing endpoint is the wrong shape for the target architecture even though every live path is blocked. |
| **PC-02** | **Medium** | `POST /partner-instructions` requires only *any verified organization principal* — no capability scope, unlike `POST /execution-intents` which requires `transaction:create`. The most Pattern C-shaped endpoint in the tree has the weakest authorization of the execution-adjacent routes. |
| **PC-03** | **Medium (characterization)** | `ExecutionOrchestrationService` signs the instruction envelope with a SELVO-held partner-credential HMAC (`signPartnerInstructionHmac`, vault key `instruction_hmac`), yet `OrchestratedExecution.meridianKeysUsed` is typed and stored as `false`. The claim is defensible — the HMAC is an API credential over an envelope, not a customer transfer authorization, and `transferSigned` is separately false — but a field named `meridianKeysUsed: false` on a row whose creation required a SELVO key signature is a characterization risk in exactly the document an auditor would read. Needs either a rename or an explicit comment distinguishing the three signature categories. |
| **PC-04** | **Medium (gap)** | `ExecutionIntent` is **record-only, not Pattern A-compliant in the useful sense.** Spec §2 Pattern A requires producing a **signable execution-intent object returned to the customer** so the customer can initiate. The current DTO carries id, route, assets, amount, `status: 'recorded'`, `executable: false`, `submitted: false` — no signature, no canonical signable payload, no provider-submission envelope. The customer cannot act on it. Pattern A is therefore not yet *implemented*; it is merely not violated. |
| **PC-05** | Low | `POST /api/v1/partner-webhooks/:partnerId` is inbound (not Pattern C) but unauthenticated with no signature, timestamp, or replay protection, resolving instructions via `findByIdAnyTenant`. Sandbox-only today. Spec §15/§20 will require full webhook verification before any partner integration. Already recorded as R1 in `SELVO_ARCHITECTURE_CURRENT.md`. |
| **PC-06** | Info | `POST /api/v1/executions` correctly returns **501** with an audited rejection before any auth or org check. Confirmed intact. Spec §22 requires it stay that way. |

### 1.4 Signature inventory

Spec §26 forbids signing a customer transfer authorization. The three categories must not be
conflated:

| Category | Instance | Key | Verifier | Assessment |
| --- | --- | --- | --- | --- |
| (i) Attestation about a past event | Ed25519 execution receipt | vault `receipt_ed25519` | anyone | Safe — post-facto, returned to caller |
| (ii) API request to a partner | `signPartnerInstructionHmac` | vault `instruction_hmac` per partner | the partner | Pattern C-adjacent; gated. See PC-03 |
| (iii) Customer transfer authorization | **none** | — | — | Correct: SELVO never signs one. The caller's own signature is accepted and only its hash is stored |

---

## 2. §28.3(b) — Monetization pricing-shape audit

None of the five flags in spec §18.3 (`FLAT_TXN_PRICING_ENABLED`, `TIERED_TXN_PRICING_ENABLED`,
`AD_VALOREM_PRICING_ENABLED`, `GAIN_SHARE_ENABLED`, `TPV_PRICING_ENABLED`) exists in the repository.
Every computation below therefore runs with **no pricing-shape gate**.

### 2.1 Classification of every pricing computation

| Computation | Location | Formula | Shape | Spec risk | Required flag | Gated today by |
| --- | --- | --- | --- | --- | --- | --- |
| Platform markup | `routing-cost.ts:333` | `sendAmount × markupBps / 10_000` | **Ad valorem** | **HIGH** | `AD_VALOREM_PRICING_ENABLED` | existence of an active `CustomerPricing` row + non-null `organizationId` only |
| Infrastructure surcharge | `routing-cost.ts:365` | `sendAmount × surchargeBps / 10_000` | **Ad valorem** | **HIGH** | `AD_VALOREM_PRICING_ENABLED` | same |
| Platform flat fee | `routing-cost.ts:347` | fixed `platformFeeMinorUnits`, mid-converted | **Flat** | low | `FLAT_TXN_PRICING_ENABLED` | same |
| Partner commission | `monetization-engine.ts:236` | `min(platformRevenue × 2500bps, platformRevenue)` | **Gain-share** | **HIGHEST** | `GAIN_SHARE_ENABLED` | computed always; only the *payout* is gated by `BILLING_LIVE_ENABLED` |
| Take rate | `monetization-engine.ts:249` | `platformRevenue / TPV × 10_000` | Metric (not a pricing input) | — | exposure policy, not a flag | none |
| TPV | `monetization-engine.ts:494` | `sendAmount.minorUnits` | **Tracking only** | — | none | none |
| Spread discount | `routing-cost.ts:95` | rate narrowed by `discountBps` | Customer benefit, not revenue | — | none | same rule selection |
| Invoice subtotal | `billing-engine.ts:135` | sum of snapshot platform revenue, tax `0` | Aggregation | inherits | — | ops operator key |
| Enterprise subscription | `demo-monetization.ts:138` | manual flat amount, TPV `0` | **Subscription (flat)** | none per §18.1 | none | demo/seed only |
| Stablecoin / DeFi sub-routes | `stablecoin-routing.ts:150`, `defi-routing.ts:161` | `NO_ROUTING_PLATFORM_CHARGE` | Zero fee | — | — | hard-coded zero |

Confirmed absent: tiered-by-size **platform** pricing, TPV-based **pricing**, per-API-call billing
metering, plan catalog, seats, recurring charge engine.

The markup application site, for reference:

```ts
// packages/core/src/engine/routing-engine.ts:472
private platformCharge(...): RoutingPlatformCharge {
  if (input.organizationId === null || pricingRules.length === 0) {
    return NO_ROUTING_PLATFORM_CHARGE;
  }
  const rule = selectPricingRule(pricingRules, { organizationId, ... at: requestedAt });
  return { ruleId: rule.id, markupBps: parseDecimal(rule.markupBps), ... };
}
```

One genuinely good property: **there is no silent default take rate.** With no pricing rule the
platform charge is exactly zero. Ad-valorem revenue only exists where an operator explicitly
attached a rule.

### 2.2 Findings

| ID | Severity | Finding |
| --- | --- | --- |
| **MON-01** | **High** | **Ad-valorem pricing is live in production with no §18.3 flag.** `markupBps` and `surchargeBps` are basis points of send notional, applied on `POST /comparisons`, `POST /routes`, and `POST /quote` whenever a `CustomerPricing` row exists. Per spec §18.3/§18.4 this shape may not be active in production without a written legal opinion. It is currently active by default for any org with a pricing rule. |
| **MON-02** | **High** | **Gain-share is computed unconditionally.** `partnerCommissionMinorUnits` defaults to **2500 bps (25%) of SELVO platform revenue** and SELVO is the payer (`grossProfit = platformRevenue − partnerCommission`). This is the spec's *highest*-risk shape. The payout is blocked by `BILLING_LIVE_ENABLED`, but the computation, storage, and dashboard reporting are not gated at all. |
| **MON-03** | **Medium** | **The spec's safe default is unimplementable today.** §18.1 makes API-usage pricing the primary production revenue model, but there is no per-organization API-call meter anywhere. What exists is rate limiting (`rate_limit_buckets`, a throttle) and dashboard quote counts (analytics). Shipping §18.1 requires building a meter first. |
| **MON-04** | **Medium (§18.3)** | **Take rate is exposed on customer-facing surfaces.** `takeRateBps` appears in the `POST /api/v1/routes` response (`data.monetization.takeRateBps` — and that endpoint is **public/anonymous-callable**), on the org dashboard revenue page, and inside signed Ed25519 receipts. §18.3 requires take-rate machinery to be internal-only until the corresponding flag is legitimately active. In practice an anonymous caller gets `null` because there is no org pricing rule, but the field is in the public DTO and the authenticated org surface shows a real number. |
| **MON-05** | Low | No subscription plan catalog, seat model, tier definition, or recurring charge engine exists; `attemptLiveSubscriptionBilling` returns `subscriptionsCharged: 0` by construction. §18.1 subscription revenue is a label today, not a mechanism. |
| **MON-06** | Info | `/comparisons` DTO hard-codes `platformPricing.flatFee: null` (`comparison-from-routing.ts:137`) even when a flat fee is configured, while the fee still affects `platformFeeCost`. A disclosure inconsistency relative to §18.6. |
| **MON-07** | Info | Disclosure structure already matches §18.6: the customer sees provider fee, network/gas fee, and a distinctly labelled platform fee as separate breakdown lines. The problem with ad valorem is its *shape*, not its transparency. |

---

## 3. §28.3(c) — Revenue lifecycle audit

Spec §18.2 requires `QUOTED → EXPECTED → ATTRIBUTED → REALIZED`, with only `REALIZED` recognizable
as cash and only against provider-confirmed settlement plus a valid contract.

### 3.1 The constraint the spec asks us to reuse does exist

Confirmed verbatim in `prisma/migrations/20260828180000_platform_invoices/migration.sql`:

```sql
ADD CONSTRAINT "monetization_events_realized_revenue_collected_chk"
  CHECK (
    ("realized_revenue" = false AND "revenue_recognition" IN ('unrealized', 'invoiced'))
    OR ("realized_revenue" = true AND "revenue_recognition" = 'collected')
  );
```

Alongside it: `monetization_events_{funds_moved,custody,real_execution}_false`, and on `invoices`
CHECKs pinning `status='issued'`, `collection_status='uncollected'`,
`issuer_legal_entity='unconfirmed'`, `tax_calculation='deferred'`, `tax_minor_units=0`. The
non-custodial and not-yet-collecting posture is enforced by the database, not just by convention.

### 3.2 Mapping the spec's four states onto the existing two axes

| Spec state | Existing mapping | Confidence | Gap |
| --- | --- | --- | --- |
| `QUOTED_REVENUE` | `economicStage: route_quote` + `revenueRecognition: unrealized` | High | Clean match |
| `EXPECTED_REVENUE` | `economicStage: execution_intent` + `unrealized` | Medium | `route_selected` exists in the enum but **is never written by any production path** — there is no state for "customer picked a route, no intent yet" |
| `ATTRIBUTED_REVENUE` | Ambiguous: `execution_intent`+`unrealized`, or `settled`+`unrealized`, or any stage + `invoiced` | **Low** | The existing model splits attribution across two axes with overlapping meanings |
| `REALIZED_REVENUE` | Intended `collected` + `realizedRevenue: true` | **Not expressible** | No writer, readers force `false`, and no contractual-arrangement field exists on the row |

### 3.3 Findings

| ID | Severity | Finding |
| --- | --- | --- |
| **REV-01** | **High** | **Three conflicting definitions of "realized" coexist.** (1) The DB CHECK ties `realized_revenue` to `collected`. (2) `realizedRevenueMinorUnits` in the dashboard summary is computed from `economicStage === 'settled'` (`monetization-engine.ts:311`). (3) The TypeScript type pins `realizedRevenue: false`. Definition (2) is the one customers see. |
| **REV-02** | **High** | **A sandbox mock can inflate a field named "realized revenue."** Sandbox orchestration writes `economicStage: 'settled'` (`execution-orchestration-service.ts:373`) on a mock partner's say-so, and the aggregation counts exactly that stage as realized. This is the precise failure mode §18.2 forbids: simulated outcome presented as realized cash. |
| **REV-03** | **High** | **The CHECK constraint is inert in the application.** No code writes `revenueRecognition: 'collected'` or `realizedRevenue: true`, and every read path hardcodes `realizedRevenue: false` (`prisma-dashboard.ts:447`, `prisma-billing.ts:308`, `serialize.ts:1115`). The column cannot surface `true` even if inserted manually. |
| **REV-04** | **Medium** | **Headline revenue totals are lifecycle-blind.** `platformRevenueMinorUnits` and `grossRevenueMinorUnits` sum across all stages and recognitions; the `byRail` / `byProvider` / `byCurrency` / `byAgent` breakdown rows carry no lifecycle field at all. Separate Realized/Invoiced/Collected cards exist, but the headline number a reader anchors on mixes quoted with invoiced. |
| **REV-05** | **Medium** | **Platform-fee amounts appear on many surfaces with no lifecycle tag**: `/routes` per-route `breakdown.platformFee`, `/comparisons` `breakdown.platformFeeCost`, agent `QuotedRouteOption.platformFeeMinorUnits`, the revenue events ledger and breakdown tables in `revenue-report.tsx`, invoice line amounts (stage only, no recognition), and the onboarding pricing input. Only `/routes` top-level monetization carries partial tagging (`stage` + `realizedRevenue`, no `revenueRecognition`). |
| **REV-06** | Low | `route_selected` is a dead enum value; `billing-engine.ts` reconciliation labels a field `quotedPlatformRevenueMinorUnits` while summing **all** events regardless of stage. |
| **REV-07** | Info | **PA-H07 is genuinely fixed.** Every revenue aggregation and chart path uses `bigint`/`Decimal` (`monetization-engine.ts:306`, `billing-engine.ts:413`, `chart-display.ts:9`), with a regression test at near-2^53 volumes. Residual `Number()` is display-only on bps/percent strings and CSS bar widths. Spec §5 and §21 are satisfied here. |
| **REV-08** | Info | Invoice issue flips `unrealized → invoiced` atomically with an audit event recording `from`/`to`, `realizedRevenue: false`, `collected: false`. The mechanism is sound; it simply stops one state short of the spec's REALIZED. |

---

## 4. Spec → current state mapping

| Spec § | Requirement | Current state | Gap |
| --- | --- | --- | --- |
| §1 Identity | Non-custodial orchestration layer, not an institution | Matches. `MASTER_PRODUCT_DEFINITION.md` already declares this; `/meta` publishes it | Terminology only |
| §2 Execution boundary | Pattern A/B only; Pattern C fail-closed | Behaviour compliant; **Pattern A not implemented** (PC-04); two Pattern C shapes gated (PC-01) | Build a signable, returnable intent object; reshape the instruction endpoint |
| §3 Functional ≠ corporate separation | Modules in one codebase | Matches — single monorepo, single company | None |
| §4 Three-layer safety | AI proposes, deterministic decides, execution external | **Structurally satisfied** — but only because Layer 1 is a regex parser, not a model | The trust boundary appears when a real model does |
| §5 Engineering invariants | Decimal/bigint, adapters, fail closed, no fabrication, audit, org isolation, backwards compatible | **Satisfied.** `DecimalInput` excludes `number` by type; `bigint` minor units; 83 audit event types; append-only trigger; `custody-guardrail.test.ts` | Maintain |
| §6 Execution modes | DEMO / SIMULATION / PARTNER_SANDBOX / PRODUCTION | **Two modes only** (`sandbox`/`production`); the other three live on unrelated axes | Four-value migration touches registries, container, env schema, Dockerfile, `/meta`, gate tests |
| §7 Rail abstraction | `FinancialRail`, `FinancialProvider`, capability interfaces | `FinancialProvider`, `ProviderCapabilityProfile`, `ProviderDescriptor` exist; no `FinancialRail` entity (rails are an enum) | Add rail as a first-class entity if capability metadata needs to hang off it |
| §8 Universal quote | ~20-field normalized quote | `NormalizedQuote` covers most; **absent:** `complianceCost`, `settlementCost`, `guaranteedSettlementTime`, `successProbability` as explicit fields | Additive fields |
| §9 Route graph | Persistent cross-rail graph, 15 node kinds, 8 relationship types | 10 node kinds, unpriced discovery only, **not persisted**; `BRIDGE`, `CARD`, `CHAIN` absent | Persist the graph; add node kinds; the outcome-history moat does not exist yet |
| §10 Best execution | Weighted ranking + explainable breakdown | **Closest to target.** 7 factors, `scoreComponents`, `routeExplanation`, `bestExecution` with `rationaleHash` | Add counterparty risk, success probability; the UI renders almost none of it |
| §11 Compliance intelligence | Decision support; obliged entity stays with partner | Manual KYB + route metadata; **caller-supplied sandbox outcome defaulting to `pass`**; `complianceOf()` always `eligible: true` | No `UNKNOWN`, no screening, no per-intent decision record |
| §12 Liquidity intelligence | Discovery, depth, prediction | Provider-disclosed depth → headroom → score + rail health | No liquidity source model, no prediction, no REAL/PARTNER/SIMULATED/DEMO separation |
| §13 AI financial intent | NL → structured intent; no invented values | Deterministic parser with `aiUsed: false`, `didNotCompute: [rates, fees, slippage, settlement]` | No model; no `FinancialIntent` entity; no intent UI |
| §14 Authorization gate | 13 named policy controls | 10 of 13 exist on `PaymentPolicy` | **Absent:** `requiredSettlementTime`, `approvalRules`, monthly limit; **no `policyVersion`** |
| §15 Settlement generate-and-return | Instruction created and returned, never transmitted | **Inverted** — the endpoint dispatches (PC-01). No generic `SettlementRail`/`SettlementInstruction`/`SettlementEvent` model | Highest-priority architectural correction |
| §16 Reconciliation | End-to-end reconcilable | 8 mismatch kinds against mock partner data; no `ReconciliationRecord` model | Expected-vs-actual record, `MISMATCH` alerting |
| §17 Tokenized assets | Data/routing only; issuance `PARTNER_REQUIRED` | **Nothing exists.** Non-fiat assets are USDC, USDT, ETH | Entire module. Depends on composed multi-leg pricing, which also does not exist |
| §18 Monetization | Usage/subscription default; five risk-tiered flags; lifecycle state machine | See §2 and §3 above | MON-01…07, REV-01…06 |
| §19 Revenue attribution | 15-category attribution, lifecycle-tagged | `MonetizationEvent` covers 9 revenue sources; no per-category attribution record | Additive; must be lifecycle-tagged from the start |
| §20 Exception management | Queue → human review → approve/reject | **Nothing.** `COMPLIANCE_REVIEW` status has no queue, UI, or release path | Entire module; overlaps human-in-the-loop |
| §21 Dashboard | Command center, decimal-safe, lifecycle-labelled | 9 nav items; decimal-safe (REV-07); **revenue widgets mix lifecycle states** (REV-04) | 7 nav sections absent; metrics lack source/timestamp/method metadata |
| §22 API surface | 16 named endpoints | Existing equivalents: `/quote`, `/routes/search`, `/providers`, `/assets`, `/currencies`, `/reconciliation/mismatches`, `/dashboard/revenue`. **Absent:** `/intents`, `/best-execution`, `/compliance/check`, `/liquidity/search`, `/settlement/instructions`, `/settlement/:id`, `/rails`, `/analytics`, `/pricing` | `POST /executions` 501 confirmed intact |
| §23 Database | Inspect, reuse, non-breaking | 41 models, 19 enums, 22 migrations documented in `SELVO_ARCHITECTURE_CURRENT.md` §2 | Reuse table in §5 below |
| §24 Phase order | P1–P22 | P1 and P2 complete | §6 below |
| §25 Per-phase report | Fixed report template | Applied to P1/P2 in §7 below | Use for every phase |
| §26 Absolute rules | Never/always lists | No violation found. Nearest concerns: PC-03 (`meridianKeysUsed` naming), REV-02 (simulated presented as realized), MON-01/02 (transaction pricing unflagged) | Fix the three |
| §27 Final principle | Own the intelligence layer, not the rails | Matches | None |

---

## 5. Reuse map — do not duplicate (spec §23)

| Spec model | Existing equivalent | Action |
| --- | --- | --- |
| `Provider`, `ProviderCapability`, `Currency`, `Route`, `Quote`, `QuoteLeg`, `TransactionRequest`, `Fee`, `CustomerPricing`, `AuditLog` | All exist | **Extend only** |
| `AgentPolicy` | `PaymentPolicy` (12 controls) | Extend + add versioning |
| `AgentIntent` | `PaymentIntent` (agent-specific) | New `FinancialIntent` is justified; do not fork `PaymentIntent` |
| `ExecutionAuthorization` | `PaymentIntent.POLICY_APPROVED` + audit rows + `executionAuthorized` flags | New unified record justified |
| `ComplianceDecision` | `COMPLIANCE_OUTCOMES` (3 values, no persistence) | New model justified |
| `PricingRule` | `CustomerPricing` | **Extend — do not add a second pricing table** |
| `RevenueRule`, `RevenueAttribution`, `TransactionRevenue` | `MonetizationEvent` | Extend or relate; do not duplicate the ledger |
| `RevenueLifecycleState` | `economicStage` × `revenueRecognition` × `realizedRevenue` | **Reconcile the three before adding a fourth axis** (REV-01) |
| `SettlementRail`, `SettlementInstruction`, `SettlementEvent`, `ReconciliationRecord` | `PartnerInstruction`, `OrchestratedExecution` only | New models justified; relate to `PartnerInstruction` |
| `LiquiditySource`, `LiquidityQuote` | `LiquidityInfo` on quotes (not persisted) | New models justified |
| `TokenizedAsset`, `AssetEligibility` | Nothing | New |
| `FinancialRail`, `RailCapability`, `ProviderRail` | `ProviderRail` **enum** + `RAIL_REGISTRY` | Promote to entity only if capability metadata requires it |
| `PricingFlagConfig` (with `legalOpinionId`) | Nothing. Closest discipline: `LiveEnablement` (`approvedBy`, `licenseBasis`, `approvedAt`, `expiresAt`, `checklistRef`, auto-expiry) | **Reuse the `LiveEnablement` pattern** — it already implements §18.4's "the gate is a document" requirement |

`LiveEnablement` deserves emphasis: it already requires a named approver, a license basis, an
approval timestamp, an expiry that fails closed, and a checklist reference. Spec §18.4 asks for
exactly this shape for pricing flags. Extend it rather than inventing a parallel mechanism.

---

## 6. Recommended sequencing

The spec's P1–P22 order is sound with three adjustments, each driven by a finding above.

**Adjustment 1 — reconcile the revenue lifecycle before building attribution (§18.2 before §19).**
REV-01/02/03 mean the existing model actively misreports. Adding a 15-category attribution record on
top of three conflicting "realized" definitions multiplies the inconsistency. This is also the
cheapest high-value fix in the document: stop counting `economicStage === 'settled'` as realized,
make the type admit `true`, tag every revenue-shaped surface, and label the headline totals.

**Adjustment 2 — flag the existing transaction pricing before building more of it (§18.3 early).**
MON-01/02 are live in production now. Introducing the five flags and putting `markupBps`,
`surchargeBps`, `platformFeeMinorUnits`, and `partnerCommission` behind them — defaulting to false,
with `LiveEnablement`-style `legalOpinionId` required to flip — is a contained change that moves the
system from "high-risk pricing on by default" to the spec's posture. Note the consequence to decide
explicitly: **any organization currently relying on a `CustomerPricing` markup would see its
platform fee go to zero** when the flag defaults false. That is the correct default per §18.4 and a
commercial decision, not a technical one.

**Adjustment 3 — correct the settlement boundary shape before building settlement (§15 before
P11).** PC-01/PC-04 together mean the target's central endpoint shape does not exist and the
existing one is inverted. Implementing `POST /api/v1/settlement/instructions` as
generate-and-return, and giving `ExecutionIntent` a canonical signable payload the customer can act
on, establishes Pattern A properly. Build settlement tracking on top of that, not on top of the
dispatch path.

Resulting order:

| Order | Phase | Rationale |
| --- | --- | --- |
| 1 | P1 inspection | **Complete** |
| 2 | P2 architecture docs | **Complete** (this document closes it) |
| 3 | §18.2 lifecycle reconciliation | REV-01/02/03 — stop misreporting first |
| 4 | §18.3/18.4 pricing flags + `legalOpinionId` gate | MON-01/02 — fail-close what is already live |
| 5 | §15/§2 boundary correction | PC-01/PC-04 — establish Pattern A properly |
| 6 | P21 security hardening | PC-02/PC-05, plus the twelve observations in `..._CURRENT.md` §12 |
| 7 | P9 usage metering + subscription | MON-03 — make the safe default actually shippable |
| 8 | P19 dashboard lifecycle labelling | REV-04/05 — the UI is where misreading happens |
| 9 | P11/P12 settlement + reconciliation models | On the corrected boundary |
| 10 | P14/P15 authorization record, policy versioning, compliance decision | REV-06, §14 gaps, `UNKNOWN` state |
| 11 | P13 AI intent + `FinancialIntent` | Where the real trust boundary appears |
| 12 | P3–P8, P10, P16, P17, P20, P22 | Remaining capability surface |

Transaction-value machinery stays in the data model and stays off in production, per §24's note.

---

## 7. Per-phase report (spec §25)

```
PHASE: P1 — Repository inspection
Implemented: Full read-only inspection of package.json, README, Prisma schema (41 models,
  19 enums, 22 migrations), all 108 route handlers, packages/core engines and domain,
  packages/adapters, packages/persistence, apps/web, .env.example, Dockerfile,
  docker-compose.staging.yml, CI workflow, 142 test files, 8 Playwright specs, 16 existing docs.
Files changed: none (docs/SELVO_ARCHITECTURE_CURRENT.md added)
Database changes: none
API changes: none
Security changes: none. Twelve observations recorded as pending triage (R1–R12).
Tests: none added; existing suite untouched and unrun (node_modules absent in this environment)
Monetization flags touched: none — the five §18.3 flags do not exist yet
Execution/settlement boundary impact: none (read-only)
Potential regulatory issue: PC-01 partner-instruction dispatch shape; MON-01 ad-valorem active in
  production without a flag; MON-04 take rate on a public DTO; REV-02 simulated outcome counted
  as realized revenue
Remaining blocker: none for this phase
Production readiness: unchanged. Production remains fail-closed with an empty licensed registry.
```

```
PHASE: P2 — Architecture documentation + gap analysis
Implemented: docs/SELVO_ARCHITECTURE_TARGET.md (target state, launch vs deferred scope) and
  docs/SELVO_GAP_ANALYSIS.md (this document). Three targeted audits completed as required by
  §28.3: Pattern C boundary crossings, monetization pricing shapes, revenue lifecycle tagging.
Files changed: none (two docs added)
Database changes: none
API changes: none
Security changes: none
Tests: none added
Monetization flags touched: none
Execution/settlement boundary impact: none. Audit confirms POST /api/v1/executions returns 501,
  no adapter makes an outbound network call, and both Pattern C-shaped paths are blocked in
  production by multiple independent gates.
Potential regulatory issue: as recorded in §1, §2, §3 of this document — 6 Pattern C findings,
  7 monetization findings, 8 revenue-lifecycle findings.
Remaining blocker: three decisions required from the product owner before P3 (see §8).
Production readiness: unchanged.
```

---

## 8. Decisions required before implementation

These are commercial, legal, or product decisions that code cannot make.

1. **Ad-valorem default (MON-01).** Putting `markupBps`/`surchargeBps` behind
   `AD_VALOREM_PRICING_ENABLED=false` zeroes the platform fee for any organization with an existing
   `CustomerPricing` markup. Correct per §18.4 — confirm before it ships.
2. **Partner commission (MON-02).** The 25%-of-platform-revenue default is the spec's
   highest-risk shape. Confirm whether it stays computed-but-unpaid behind `GAIN_SHARE_ENABLED`, or
   is removed from the default path entirely.
3. **Take-rate exposure (MON-04).** §18.3 says internal-only. Removing `takeRateBps` from the
   public `POST /routes` DTO and the org dashboard is an API-contract change — confirm, since it is
   currently a documented response field.
4. **`legalOpinionId` source of truth.** Whether pricing-flag gating extends the existing
   `LiveEnablement` table (recommended — it already has approver, license basis, expiry, checklist
   reference) or gets a separate `PricingFlagConfig`.
5. **Sandbox `settled` semantics (REV-02).** Whether sandbox orchestration should stop writing
   `economicStage: 'settled'`, or the aggregation should stop treating that stage as realized.
   Recommended: both — the stage is legitimate, counting it as realized cash is not.
