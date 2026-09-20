# Monetization — revenue lifecycle, pricing shapes, and billing

Spec §18. This is the reference for what SELVO may charge, what it may call revenue, and which
of those two questions a given field answers. Two rules run through all of it:

- **A number is labelled by what it is, not by what it is hoped to become.** Quoted revenue is not
  expected revenue, and neither is cash.
- **A shape that is switched off contributes zero and does not appear in reporting.** Not
  "computed but unpaid" — absent.

Neither rule is aspirational. Both are enforced by the resolver and the admission gate described
below, and both have regression tests that fail the build.

---

## 1. Revenue lifecycle

```
QUOTED_REVENUE → EXPECTED_REVENUE → ATTRIBUTED_REVENUE → REALIZED_REVENUE
```

| State | What it asserts | What it does not assert |
| --- | --- | --- |
| `QUOTED_REVENUE` | A quote was priced. | Any commitment by anyone. |
| `EXPECTED_REVENUE` | A route was selected, or an execution intent recorded. | That it will be billed. |
| `ATTRIBUTED_REVENUE` | A settlement occurred, or an invoice was issued. | That the invoice was paid. |
| `REALIZED_REVENUE` | Cash was collected against a provider-confirmed settlement. | — |

### One function decides state

`resolveRevenueLifecycle` (`packages/core/src/domain/revenue-lifecycle.ts`) is the only place a
lifecycle state is computed. Every read path — dashboard, revenue API, analytics, attribution —
derives from it. It is pure and synchronous specifically so no caller has an excuse to
reimplement it inline.

Before it existed there were three disagreeing answers to "is this revenue realized?": a database
CHECK constraint tying `realized_revenue` to `revenue_recognition = 'collected'`, a dashboard
total that summed `economicStage === 'settled'`, and a TypeScript literal pinning
`realizedRevenue` to `false`. The middle one was reachable by a **sandbox mock partner**, so a
simulated run inflated a field labelled "realized revenue".

### Promotion to REALIZED requires four independent facts

All four, all real. Missing any one caps the record at `ATTRIBUTED_REVENUE` and records why in
`capReasons`:

| Fact | Cap reason when missing |
| --- | --- |
| `originEnv === 'PRODUCTION'` | `non_production_origin` |
| `settlementFinality === 'provider_confirmed'` | `settlement_not_provider_confirmed` |
| `revenueRecognition === 'collected'` | `recognition_not_collected` |
| A non-empty `collectionReference` | `collection_reference_missing` |

`assertRealizationClaimSupported` applies the same rules at the write site, which is the
application-layer half of the database constraint: a bad write fails with a precise message rather
than as a constraint violation.

### Origin environments

Every revenue record carries an `originEnv` stamp: `DEMO`, `SIMULATION`, `PARTNER_SANDBOX`, or
`PRODUCTION`. It is derived from the running platform mode (`revenueOriginEnvForMode`), so a
sandbox process cannot pass `PRODUCTION`; seeded demo data and sandbox-partner settlements
override it downward at their own write sites.

**Only `PRODUCTION` can reach `REALIZED_REVENUE`.** A demo dataset, a deterministic simulation and
a partner sandbox are all incapable of confirming that cash arrived, whatever status they report.
This holds even when a real payment was collected for the invoice: `collection-service.test.ts`
covers exactly that case, because a real payment for a simulated route does not make the simulated
economics real.

### Settlement finality

`unsettled` → `simulated` → `provider_confirmed`. `simulated` is deliberately a distinct value
rather than a flag on `settled`: a sandbox partner reporting `settled` produces `simulated`, and
`simulated` can never satisfy realization.

---

## 2. Pricing shapes

Five shapes, one flag each. They are separate flags because they are separate regulatory
questions — a fixed fee per decision is software usage, a percentage of notional looks like
intermediation economics, and a share of savings is economic participation in the customer's
outcome. One switch for "transaction pricing" would mean enabling the cheap-to-justify shape also
enables the expensive-to-justify one.

| Shape | Flag | Launch | Risk | Determination scope |
| --- | --- | --- | --- | --- |
| Flat per decision | `FLAT_TXN_PRICING_ENABLED` | **on** | low | — |
| Tiered by size | `TIERED_TXN_PRICING_ENABLED` | off | low–medium | — |
| Ad valorem (% of notional) | `AD_VALOREM_PRICING_ENABLED` | off | high | `pricing_ad_valorem` |
| Gain share (partner commission) | `GAIN_SHARE_ENABLED` | off | **highest** | `pricing_gain_share` |
| TPV based | `TPV_PRICING_ENABLED` | off | high | `pricing_tpv` |

### Fail closed means absent, not unpaid

A disabled shape contributes zero to any customer charge **and** is excluded from customer-facing
revenue reporting. `gatePlatformChargeByShape` strips `markupBps` and the surcharge before pricing
when ad valorem is closed, and strips the flat fee when FLAT is closed. The customer discount is
deliberately never gated — gating it would raise the price.

Gain share is zeroed on **read** as well as on write. Rows written before the gate existed carry a
25% commission that was never contractually owed, and reporting it would present an unauthorized
shape as revenue. When the gate is closed there is no partner payout row in `byRevenueSource` at
all, and the dashboard omits the commission card rather than showing a zero a reader could mistake
for an arithmetic result.

With no negotiated pricing rule the platform charge is exactly **0**. There is no silent default
take rate, whatever the flags say.

### A high-risk shape needs a document, not a flag

`AD_VALOREM`, `GAIN_SHARE` and `TPV` cannot be active in production without both halves of a gate:

1. **Config half** — a referenced `*_LEGAL_OPINION_ID` and `*_JURISDICTION`. Missing either is
   rejected at config load, not silently ignored.
2. **Record half** — a current `LiveEnablement` row for **that shape's own scope**, whose
   `licenseBasis` names that opinion id and whose `region` matches that jurisdiction.
   `assertPricingShapeAdmissionSafe` refuses to finish container construction otherwise.

One determination must never authorize a different activity. A gain-share row says nothing about
charging a percentage of notional; a live-execution row says nothing about pricing at all. Each
scope has its own section in `GO_LIVE_CHECKLIST.md`, its own approver, and its own expiry — and the
gate closes at the expiry instant rather than at the next process restart, because
`PricingShapeRegistry.current()` re-evaluates against the clock on every read.

### FLAT is size-independent, by signature

FLAT is only low-risk if it is strictly independent of transaction size. `flatDecisionFee` takes
the configured amount and the target asset and **nothing else** — it cannot read a notional
because it is never given one. `flatDecisionFeeMinorUnitsFor` takes the subscription and the
catalog, likewise. A future change that scaled FLAT by size would have to change those signatures,
which is what CI is watching for, alongside a test that charges the identical fee on a $10 and a
$10,000,000 decision.

The per-organization override in `CustomerPricing` is a flat minor-unit constant. The API schema
rejects `0.25`, `25%` and `25bps` so a rate cannot be smuggled in as a "fee".

---

## 3. Billable-event taxonomy

Three charge classes. One logical action maps to **exactly one** of them, so the customer-facing
total stays `Provider Cost + Network Cost + SELVO Fee` with no hidden second fee.

| Class | What it bills | Cadence |
| --- | --- | --- |
| `SUBSCRIPTION_PERIOD` | Monthly platform access for the subscribed tier | One per org per period |
| `METERED_CALL` | API calls beyond the tier's included quota | One line per period |
| `FLAT_DECISION` | One size-independent routing decision | One line per decision |

### Which action triggers which event

| Action | Class | Metered? |
| --- | --- | --- |
| `quote.read` — `POST /quote`, `/comparisons`, `/provider-quotes` | `METERED_CALL` | yes → `quote` |
| `route.search` — `POST /routes`, `/route-graph/paths`, `/stablecoin-routes`, `/defi-routes` | `METERED_CALL` | yes → `route_search` |
| `compliance.screen` | `METERED_CALL` | yes → `compliance` |
| `liquidity.inspect` — `GET /defi-liquidity` | `METERED_CALL` | yes → `liquidity` |
| `settlement.status` — `GET /executions/:id` | `METERED_CALL` | yes → `settlement_status` |
| `reconciliation.report` — `GET /reconciliation/mismatches` | `METERED_CALL` | yes → `reconciliation` |
| `decision.execution_intent` — `POST /execution-intents` | `FLAT_DECISION` | **no** |
| `subscription.period` — month-end billing run | `SUBSCRIPTION_PERIOD` | **no** |

`decision.execution_intent` is the entry that matters. Generating an execution intent **is** an
API call, so without the rule it would be billed as both a metered call and a per-decision fee.
It is charged `FLAT_DECISION` only; `isMeteredAction` excludes it from the meter, so the decision
fee replaces the call charge instead of stacking on it.

`assertNoDoubleCharge` refuses a charge set that bills one action under two classes, and
`composeDraftInvoice` allows at most one `SUBSCRIPTION_PERIOD` and one `METERED_CALL` line per
period. An overlapping taxonomy surfaces as a refused billing run, not as a customer noticing they
paid twice.

### What is not billable

The metered route map is an **allow-list**, not "everything not excluded". A new endpoint is
unbilled until someone decides what it costs — the failure direction that cannot surprise a
customer with a charge. Dashboard, audit, ops and auth routes are absent on purpose: reading your
own invoice is not a billable act.

Metering runs `onResponse`, only for 2xx replies, and only for a caller with an organization. A
request that failed produced nothing worth charging for, and an anonymous caller has nobody to
bill. A metering failure is logged and swallowed: losing a count is a shortfall in the customer's
favour, while throwing would lose the answer the customer already paid for.

---

## 4. Subscription tiers

Free / Starter / Pro / Enterprise, each with a monthly base, an included call quota, a per-call
overage price and a default flat decision fee.

**The numbers are placeholders.** They are shaped correctly and none of them has been validated
commercially. No organization is being charged them. A real price list replaces them through
`SubscriptionTierCatalog` without touching the engine. Every API response carrying them sets
`pricesAreProvisional: true`.

An organization with no subscription row is on `free` — a defined tier, not an undefined state.
Counts and amounts are summed with `bigint` throughout: an enterprise caller's monthly count times
a per-call price is exactly where a float would silently round an invoice (PA-H07).

---

## 5. Collection

Two modes behind `BILLING_LIVE_ENABLED` (default `false`):

- **`RECORD_ONLY`** (launch state) — usage is metered, invoices are computed and recorded, an
  attempt is recorded so the amount and the intent are auditable, and **no processor is ever
  contacted**. The attempt's terminal status is `recorded`, deliberately distinct from `succeeded`
  so a record-only run cannot be mistaken for a payment.
- **`LIVE`** — the same pipeline with a contracted processor attached.

Moving between them is configuration plus a recorded legal determination, not a code change. That
is the point: the code is not what is unfinished.

### Live collection has its own gate

`BILLING_LIVE_ENABLED=true` is necessary and not sufficient. Collection additionally needs a
current `billing` `LiveEnablement` row — which is what attests the issuing entity, the tax
position and the processor agreement — and a registered processor adapter that can actually
collect. No processor is contracted in this repository, so `DeferredPlatformFeeCollector` is the
only implementation registered and it reports `collectionEnabled: false`. A flag cannot conjure a
payments relationship.

Each fact is reported separately in `blockingReasons` rather than collapsed into one boolean, so an
operator can see which one is missing. `GET /api/v1/ops/billing/collection` returns the gate and
its checklist reference.

### Non-custodial, and no credentials

The processor holds the payment method and moves the money. `CollectionRequest` carries a
processor-issued `paymentMethodToken` and has nowhere to put a card number or a bank account — that
absence is the design. SELVO stores only the processor's reference.

### Idempotency

The key is `collect:invoice:<invoiceId>` — derived from the invoice alone, so a retry of a failed
or interrupted attempt produces the same key and is deduplicated. A key including a timestamp or
an attempt counter would make every retry a fresh charge, which is the failure this prevents. The
key is unique in the store, `beginAttempt` returns the existing attempt instead of inserting a
second one, and confirming an already-succeeded attempt is a no-op so a redelivered webhook does
not look like a second payment.

### Only a confirmed success realizes revenue

`recognition = 'collected'` is written in exactly one place, from exactly one input: an outcome the
processor **affirmatively confirmed**, carrying a reference. Confirming the attempt marks the
invoice collected and stamps the reference onto every snapshot it billed, in the same step.

"The API call didn't error" is not collection. An accepted request, a queued charge, or a 200 with
a pending status is `confirmed: false` and records a failed attempt. A `confirmed: true` with no
reference is also a failure, because §18.5 requires a collection record and the realization chain
would otherwise be unverifiable.

And realization still has to clear the 8-A gate afterwards: a confirmed payment against a
non-production snapshot promotes recognition to `collected` and the lifecycle state stays
`ATTRIBUTED_REVENUE`.

---

## 6. Launch state

With `BILLING_LIVE_ENABLED=false` and the default flags:

- Subscription, metered usage and FLAT compute correctly and produce **recorded** invoices.
- Ad valorem, gain share, TPV and tiered contribute zero and are absent from customer-facing
  reporting.
- Dashboard realized revenue reads `0` after any sandbox run.
- Flipping a high-risk pricing flag or `BILLING_LIVE_ENABLED` without its own `LiveEnablement`
  record is rejected.
- `POST /api/v1/executions` remains `501`. Nothing here moves customer funds.
