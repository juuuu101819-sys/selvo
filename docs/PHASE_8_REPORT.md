# Phase 8 report — revenue lifecycle and launch billing

Reports per §25 of the canonical spec, one per phase. Every claim here was checked against a
running API on PostgreSQL 16 with the migrations applied and the demo tenant seeded, not only
against the in-memory driver. Where something is not done, it is listed as a blocker rather than
described as partially done.

---

## PHASE: 8-A — revenue lifecycle reconciliation

### Implemented

One resolver decides revenue state, and every revenue read goes through it.

`resolveRevenueLifecycle` in `packages/core/src/domain/revenue-lifecycle.ts` maps a snapshot onto
`QUOTED_REVENUE → EXPECTED_REVENUE → ATTRIBUTED_REVENUE → REALIZED_REVENUE`. Promotion to
`REALIZED_REVENUE` requires four independent facts: a `PRODUCTION` origin, `provider_confirmed`
settlement finality, `collected` recognition, and a processor collection reference. Any missing
fact caps the record at `ATTRIBUTED_REVENUE` and is reported as a named `capReason`, so a capped
figure explains itself rather than merely reading low.

The ad-hoc computation the gap analysis named — `realizedRevenueMinorUnits` summed from
`economicStage === 'settled'` in `monetization-engine.ts` — is gone. `settled` is still aggregated,
under the honestly-named `settledStageRevenueMinorUnits`, next to
`simulatedOriginRevenueMinorUnits`. Neither is presented as cash. `realizedRevenueMinorUnits` now
counts only what the resolver puts in `REALIZED_REVENUE`.

Every monetization record carries `originEnv` (`DEMO` / `SIMULATION` / `PARTNER_SANDBOX` /
`PRODUCTION`), `settlementFinality`, `collectionReference`, and its resolved `lifecycleState`.
The origin is derived from the running platform mode, not accepted from a caller, so a sandbox
process cannot stamp `PRODUCTION`. Sandbox execution orchestration overrides it to
`PARTNER_SANDBOX` and the seeded demo tenant to `DEMO`.

`revenueRecognition = 'collected'` is now written — in exactly one place, from exactly one input,
described under 8-B.5 — so the pre-existing CHECK constraint stopped being inert.

### Files changed

29 files, principally:

- `packages/core/src/domain/revenue-lifecycle.ts` (new) — the resolver, the state and origin
  vocabularies, cap reasons, and `revenueOriginEnvForMode`.
- `packages/core/src/engine/monetization-engine.ts` — aggregation derives every lifecycle total
  from the resolver; the `settled`-means-realized computation is deleted.
- `packages/core/src/domain/monetization.ts` — `MonetizationEvent` carries origin, finality,
  collection reference, and lifecycle state; `buildMonetizationEvent` resolves the state at
  construction so no write path can produce an unstamped record.
- `packages/persistence/src/postgres/monetization-lifecycle.ts` (new),
  `prisma-dashboard.ts`, `prisma-billing.ts`, `memory-dashboard.ts`, `memory-billing.ts` — read
  paths resolve rather than hardcode.
- `apps/web/src/components/dashboard/revenue-report.tsx` — the dashboard presents lifecycle
  states and origin, and says what the realized figure means.
- `prisma/migrations/20260918060000_revenue_lifecycle_origin/migration.sql` (new).

### Database changes

`monetization_events` gains `origin_env` (default `SIMULATION`), `settlement_finality` (default
`unsettled`), and `collection_reference`, plus an index on `(organization_id, origin_env)`.

Backfill is fail-closed rather than convenient: existing rows are stamped `SIMULATION`, and rows
at `economic_stage = 'settled'` are stamped `simulated` finality, because those stages were
written on a mock partner's report. Defaulting to `PRODUCTION` would have made a simulated row
eligible for promotion if it were ever collected.

Six CHECK constraints, all verified firing against a real engine:

| Constraint                                              | Refuses                                       |
| ------------------------------------------------------- | --------------------------------------------- |
| `monetization_events_origin_env_known`                  | an origin outside the four                    |
| `monetization_events_settlement_finality_known`         | a finality outside the three                  |
| `monetization_events_realized_requires_production`      | realized revenue on a non-production origin   |
| `monetization_events_realized_requires_finality`        | realized revenue whose finality was simulated |
| `monetization_events_realized_requires_collection_ref`  | realized revenue with no processor reference  |
| `monetization_events_collection_ref_requires_collected` | a reference on a snapshot never collected     |

### API changes

Additive only; nothing under `/api/v1` was re-keyed or removed.

`GET /dashboard/revenue` gains `quotedRevenueMinorUnits`, `expectedRevenueMinorUnits`,
`attributedRevenueMinorUnits`, `invoicedRevenueMinorUnits`, `collectedRevenueMinorUnits`,
`settledStageRevenueMinorUnits`, and `simulatedOriginRevenueMinorUnits`. Each monetization event
in the payload carries `lifecycleState`, `originEnv`, and `settlementFinality`.
`realizedRevenueMinorUnits` keeps its name and now means what it says.

### Security changes

None to authentication or authorization. The change that matters for integrity is that realization
became unforgeable by a caller: origin is derived from process mode, and the two write paths that
can set `realizedRevenue = true` both go through the resolver, with the database refusing the row
independently.

### Tests

- `apps/api/src/routes/revenue-lifecycle.test.ts` — the required regression: a full sandbox
  orchestration run, then `GET /dashboard/revenue` asserting `realizedRevenueMinorUnits === '0'`.
  It also forges a snapshot with `provider_confirmed` finality and a `PARTNER_SANDBOX` origin and
  asserts the resolver still caps it, with `non_production_origin` among the cap reasons.
- `packages/core/src/domain/revenue-lifecycle.test.ts` — 16 cases over the state machine,
  including each cap reason in isolation and in combination.
- `packages/persistence/src/postgres/prisma-driver.integration.test.ts` — each constraint above
  rejecting its own violation, and a fully-realizable row being accepted, against PostgreSQL.
- `packages/core/src/engine/monetization-engine.test.ts` — PA-H07 preserved: revenue aggregation
  stays exact past 2^53, now covering the lifecycle totals as well.

Live, against PostgreSQL, after the seeded sandbox activity plus four quote and two route-search
calls: `realizedRevenueMinorUnits: "0"`, `collectedRevenueMinorUnits: "0"`,
`quotedRevenueMinorUnits: "308200"`, `simulatedOriginRevenueMinorUnits: "308200"`.

### Monetization flags touched

None. 8-A changes no pricing.

### Execution/settlement boundary impact

None. `POST /api/v1/executions` still returns 501 (verified live). No new provider is called and
no instruction is dispatched. Pattern classification is unchanged.

### Potential regulatory issue

Resolved rather than introduced: a dashboard field labelled "realized revenue" could previously be
inflated by a simulation, which is the misstatement §18.2 exists to prevent.

One judgement is worth stating because a future reader may want to revisit it. The seeded demo
tenant's economics are stamped `SIMULATION`, not `DEMO`, because they are produced by the sandbox
pricing dataset rather than by the demo seeder. Both are non-production and neither can realize,
so nothing turns on it today; it would matter only if the two origins were ever treated
differently.

### Remaining blocker

None for 8-A.

### Production readiness

The lifecycle is production-ready as a model of revenue state. It is not a statement that any
revenue exists: with collection in `RECORD_ONLY`, `REALIZED_REVENUE` is unreachable by design.

---

## PHASE: 8-B — monetization flags and launch billing

### Implemented

**Five pricing shapes, fail-closed.** `packages/core/src/domain/pricing-shape.ts` evaluates an
admission per shape from the flag, the referenced legal opinion, and a `LiveEnablement` record for
that specific activity. A shape that is not admitted contributes exactly zero to a customer charge
_and_ is absent from customer-facing reporting. `PricingShapeRegistry` hydrates the admission once
at boot so the synchronous router can consult it without a database read per quote.

`gatePlatformChargeByShape` strips what is not admitted at the point the charge is built, so a
disabled shape is never computed and then netted out somewhere downstream. `markupBps` and the
configured surcharge — both percentages of notional — sit behind `AD_VALOREM_PRICING_ENABLED`.
The code, the schema, and the simulation path all stay; only the production charge is gated.

**Gain share is gated as a whole shape, not just its payout.** `partnerCommissionMinorUnits`
computation, attribution, and dashboard display are behind `GAIN_SHARE_ENABLED`. With it off, the
commission is zero, gross profit equals platform revenue, and the partner payout line is omitted
from `byRevenueSource` rather than shown as zero — the report carries `gainShareActive: false` so
a consumer can tell "off" from "nothing earned".

**High-risk flags need a document.** `AD_VALOREM`, `GAIN_SHARE`, and `TPV` each require their own
`<SHAPE>_LEGAL_OPINION_ID` and `<SHAPE>_JURISDICTION`, rejected at config load if absent, plus a
current `LiveEnablement` record in its own scope (`pricing_ad_valorem`, `pricing_gain_share`,
`pricing_tpv`) whose license basis names that same opinion and whose region matches that
jurisdiction. `assertPricingShapeAdmissionSafe` refuses to finish booting a production process
whose high-risk flag has no current determination behind it. One activity's determination never
authorizes another: a gain-share row does not open ad valorem, and a live-execution corridor row
opens no pricing shape at all.

**FLAT per-decision, proven size-independent.** FLAT is a fixed minor-unit constant per billable
decision, configured per customer through the existing `CustomerPricing.platformFeeMinorUnits` and
per tier through `flatDecisionFeeMinorUnits`. The subscription endpoint rejects anything that is
not a non-negative integer of minor units, so a rate cannot be entered as a "fee".

**Usage metering.** Per-organization, per-endpoint call counters over six surfaces (`quote`,
`route_search`, `compliance`, `liquidity`, `settlement_status`, `reconciliation`), aggregated in
`bigint`. A Fastify `onResponse` hook counts a call only for an authenticated organization on a
2xx, from an allow-list of routes. Metering never fails a request: the customer already has their
answer, and losing a count is a shortfall in their favour, so a counter-store failure is logged
and swallowed.

**Subscription tiers.** Free / Starter / Pro / Enterprise, each with a monthly base, an included
call quota, a per-call overage, and a flat decision fee. The numbers are shaped correctly and
commercially unvalidated, which the API says on every response that carries them
(`pricesAreProvisional: true`).

**Billable-event taxonomy.** `SUBSCRIPTION_PERIOD`, `METERED_CALL`, `FLAT_DECISION`, with a total
mapping from each billable action to exactly one class. An execution-intent decision is charged as
a decision and is deliberately not metered as a call — that overlap is the double charge §18.6
forbids.

**Both collection modes.** `RECORD_ONLY` is the default and the launch state: the pipeline runs, an
attempt is recorded so the amount and the intent are auditable, and no processor is contacted. Its
terminal status is `recorded`, deliberately not `succeeded`. `LIVE` charges through a contracted
processor adapter, and requires its own `LiveEnablement` scope (`billing`) on top of
`BILLING_LIVE_ENABLED`. Collection is idempotent per invoice, so a duplicate webhook or an
impatient operator finds the first attempt instead of charging again. Only an affirmative
confirmation carrying a processor reference writes `recognition = 'collected'`; a queued or
accepted-but-unconfirmed charge is a failure, and the invoice stays unpaid.

`collectionMode` records the mode an invoice stands in, not merely the mode it was issued under:
confirming a collection moves the invoice to `LIVE` alongside the status, because an invoice that
has been paid must not keep describing itself as record-only.

### Files changed

82 files. The substantial new modules:

- Domain: `pricing-shape.ts`, `billable-event.ts`, `subscription.ts`, `usage-metering.ts`,
  `collection.ts`.
- Engine: `collection-service.ts`, `usage-metering-service.ts`, `billing-lines.ts`,
  `pricing-shape-registry.ts`; `billing-engine.ts` extended rather than replaced.
- Persistence: `memory-launch-billing.ts`, `prisma-launch-billing.ts`.
- API: `http/usage-metering.ts`, `routes/billing.ts`, `config/env.ts`, `container.ts`.
- Docs: `docs/MONETIZATION.md` (new), `GO_LIVE_CHECKLIST.md`, `.env.example`.

### Database changes

`prisma/migrations/20260918070000_launch_billing`:

- `usage_counters` — unique per `(organization, period, endpoint)`, `call_count` as
  `DECIMAL(38,0)`.
- `organization_subscriptions` — one per organization, `flat_decision_fee_minor_units` as an
  exact integer column.
- `collection_attempts` — `idempotency_key` unique, which is the property the whole
  no-double-charge argument rests on.
- `invoice_lines` gains `event_class`, `description`, `quantity`, and a nullable
  `monetization_event_id`, with a CHECK that a `FLAT_DECISION` line names its decision and a
  period line does not.
- `invoices` gains `collection_mode` and `collection_reference`, with CHECKs that a collected
  invoice carries the reference proving it and stands in `LIVE`.

One earlier constraint was replaced rather than dropped. `invoices_collection_uncollected` pinned
every invoice to `uncollected`, which was correct when there was no collection layer at all and
would now make the only collection path the codebase has unreachable. The replacement is
conditional on the mode, keeping the same guarantee for `RECORD_ONLY` — the column default and the
launch mode — while letting a gated live collection record the payment it confirmed. Writing a
collected row requires all three of `LIVE`, the collected status, and the processor reference.

`prisma/migrations/20260918080000_agent_credential_mandate_scope` fixes an unrelated defect found
while provisioning PostgreSQL to verify the above: `agent_credentials_scopes_known` predated
mandate ingestion and did not admit `mandate:verify`, the scope every `mag_` credential is issued
with. No agent credential could be stored in PostgreSQL at all — `prisma db seed` failed outright.
Only the in-memory driver, which has no constraint, ever saw a green test.

### API changes

| Route                                    | Purpose                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `POST /ops/billing/subscriptions`        | assign a tier; operator-authenticated; rejects a rate as a flat fee    |
| `POST /ops/billing/invoices/:id/collect` | collect one invoice; idempotent per invoice                            |
| `GET /ops/billing/collection`            | current mode and every reason live collection is not active            |
| `GET /dashboard/usage`                   | the calling organization's metered usage and what it would be invoiced |

`GET /dashboard/invoices` derives its collection rollup from the invoices on the page instead of
returning a constant `deferred`; a fixed value would have become the dashboard telling a customer
their paid invoice is unpaid. `GET /dashboard/revenue` carries `gainShareActive`. Reconciliation
derives `collectedPlatformRevenueMinorUnits` and `collectionStatus` from the invoices rather than
from a pinned zero.

### Security changes

- No payment credential is accepted or stored anywhere. `CollectionService` takes a processor
  payment-method token and refuses to collect without one; a test asserts nothing resembling a
  card, CVV, IBAN, or account number reaches the processor request or the audit trail.
- Three new audit event types: `billing.collection.recorded`, `billing.subscription.assigned`,
  `billing.usage.metered`. The `RECORD_ONLY` audit record states `collected: false` and
  `fundsMoved: false`; the recognition record states `platformFeeCollected: true` and
  `customerSettlementFundsMoved: false` separately, because collecting SELVO's own fee is not
  customer settlement funds moving through SELVO and one `false` should not cover both claims.
- Flipping any high-risk pricing flag or `BILLING_LIVE_ENABLED` without its legal opinion,
  jurisdiction, and `LiveEnablement` record is refused at startup, not logged and ignored.
- `AGENT_CREDENTIAL_SCOPES` names the scopes an agent credential may hold, and keeps
  `agent_policy:write` and `mandate:revoke` unstorable rather than merely un-issued: an agent must
  not be able to widen its own policy or cancel the mandate authorizing it.

### Tests

New suites: `pricing-shape.test.ts` (22 cases), `usage-metering-service.test.ts`,
`collection-service.test.ts` against the real in-memory stores, `launch-billing.test.ts`
end-to-end over HTTP, `billable-event.test.ts`, `routing-pricing-shapes.test.ts`,
`go-live-checklist.test.ts`, `monetization-documentation.test.ts`.

The three the spec asks for by name:

- **sandbox-realized = 0** — `revenue-lifecycle.test.ts`, described under 8-A, green.
- **FLAT size-independence** — `routing-pricing-shapes.test.ts` charges the same FLAT fee for a
  \$10 and a \$10,000,000 decision and asserts equality, and asserts the FLAT path reads no
  value-derived field. Confirmed live too: with only the flat shape admitted, a \$100 and a
  \$10,000,000 quote both produced a platform charge of exactly 25 minor units, and the recorded
  snapshots show TPV of 10,000 and 1,000,000,000 minor units against identical revenue of 25.
- **no double charge** — `billable-event.test.ts` asserts the action-to-class mapping is total and
  single-valued, and `launch-billing.test.ts` asserts an execution-intent decision is billed as a
  decision and is not also metered as a call.

Suite: 1,467 passing, 4 skipped (staging smoke). Lint and typecheck clean. The 52 PostgreSQL
integration tests were run against a real PostgreSQL 16, not skipped.

Verified live on PostgreSQL: 3 quote calls and 1 route search produced counters of exactly
`quote: 3`, `route_search: 1`; a month-end run issued one recorded invoice
(`INV-202608-orgdemomerid-USD`, 9,900 minor units) carrying a single `SUBSCRIPTION_PERIOD` line,
`collectionStatus: uncollected`, `collectionMode: RECORD_ONLY`, `realizedRevenue: false`; two
collection calls produced one attempt, the second returning `replayed: true` with the same attempt
id; and realized revenue stayed `0` through all of it. Four startup refusals were confirmed by
booting the built server: `BILLING_LIVE_ENABLED`, `AD_VALOREM_PRICING_ENABLED`, and
`TPV_PRICING_ENABLED` each refused for a missing opinion and jurisdiction, and
`GAIN_SHARE_ENABLED=true` with a referenced opinion but no `LiveEnablement` row refused in
production with `pricing_gain_share:not_enabled`.

### Monetization flags touched

Matching the required defaults exactly, confirmed in the boot log
(`activePricingShapes: ["flat_txn"], billingLiveEnabled: false`):

| Flag                         | Default | State                        |
| ---------------------------- | ------- | ---------------------------- |
| `FLAT_TXN_PRICING_ENABLED`   | `true`  | on at launch                 |
| `TIERED_TXN_PRICING_ENABLED` | `false` | built, off                   |
| `AD_VALOREM_PRICING_ENABLED` | `false` | built, off, §18.4 gate       |
| `GAIN_SHARE_ENABLED`         | `false` | built, off, §18.4 gate       |
| `TPV_PRICING_ENABLED`        | `false` | built, off, §18.4 gate       |
| `BILLING_LIVE_ENABLED`       | `false` | both modes built, live gated |

No `LiveEnablement` record exists for any pricing scope or for billing, so no high-risk shape
could be admitted even if a flag were flipped.

### Execution/settlement boundary impact

None. `POST /api/v1/executions` returns 501, verified live. Billing charges for decisions and API
calls, never for moving money, and the collection adapter collects SELVO's own fee from a
customer through a processor — it does not touch a customer's settlement funds. No settlement
pattern (A/B/C) changed. Settlement-boundary work was not started, as instructed.

### Potential regulatory issue

1. **Invoices are issued by an unconfirmed legal entity with tax deferred.** `issuer_legal_entity`
   is pinned to `unconfirmed` and tax to `0`. That is accurate today and is why live collection is
   gated: the `billing` `LiveEnablement` scope requires entity and tax confirmation before
   collection can activate. It does mean that opening live collection is not purely a
   configuration change — the issuer and tax columns will need widening at that point, because a
   jurisdiction-less entity should not be invoicing for real money.
2. **Tier prices are placeholders.** They are shaped like a price list and have been validated by
   nobody. `docs/MONETIZATION.md` says so, a test keeps it saying so, and every API response
   carrying them sets `pricesAreProvisional: true`.
3. **Three shapes remain legally uncharacterised.** Ad valorem, gain share, and TPV are built and
   refused. Nothing about building them is a claim that they are permissible; the gate is there
   because that question has not been answered.

### Remaining blocker

1. **No processor adapter exists.** `DeferredPlatformFeeCollector` is the only implementation and
   it reports honestly that it cannot collect. Live collection is therefore impossible regardless
   of flags, which is the intended fail-closed state and also a genuine gap: a Stripe adapter has
   to be written and contracted before `LIVE` does anything.
2. **Entity and tax handling unconfirmed**, per the regulatory note above.
3. **Prices not commercially validated.**
4. **`POST /dashboard/usage` reports the current open period only.** Historical usage is queryable
   by explicit `periodStart` but there is no rollup view across periods.

### Production readiness

**Not production ready for charging money, and ready for launch in the sense the spec defines.**

At launch with `BILLING_LIVE_ENABLED=false`: subscription, metered usage, and FLAT compute
correctly and produce recorded invoices; FLAT is proven size-independent; the other four shapes
contribute zero and are absent from customer-facing reporting; realized revenue reads `0` after a
sandbox run; and flipping any high-risk pricing flag or live collection without its determination
is refused at startup. Every one of those was confirmed against a running server on PostgreSQL.

Moving to real cash collection needs a processor adapter and a confirmed entity and tax treatment
— which is the first remaining blocker, not a configuration toggle. Everything downstream of the
adapter is built and gated.

### Follow-ups found in the post-implementation verification pass

Two label defects surfaced while reading the running dashboard, both of the same kind as the ones
8-A was written to remove, and both fixed:

- The financial-status catalog — the source of truth `docs/API.md` is checked against — had no
  entry for the `collected` invoice status that the new collection layer can return. The coverage
  test only ran catalog → API.md, so a reachable status with no documentation passed CI silently.
  The reverse direction is now covered, and `collected` is documented as a precondition of realized
  revenue rather than as realization itself.
- Four dashboard strings asserted that collection is deferred until an entity, tax handling, and a
  processor are confirmed, and that realized revenue stays false. Those were unconditional
  sentences, so they would have kept claiming an invoice was unpaid after it was collected. They
  now describe what the rendered status means. Two of them also enumerated partner commission among
  the figures on the page, which the gain-share gate omits entirely.
