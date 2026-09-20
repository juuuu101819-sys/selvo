# Go-live checklist

Meridian is a **non-custodial** routing hub. This file is the legal/licensing gate for every
live flag in the repository. Code comments on those flags link here. **A corridor, partner, or
billing path without a section in this file cannot be live-enabled.**

Default for every flag is **OFF**. The process does not turn live on by itself.

| Flag / record | Default | Code | This file |
| ------------- | ------- | ---- | --------- |
| `PARTNER_LIVE_ENABLED` | `false` | `apps/api/src/config/env.ts` | [#partners](#partners) |
| `BILLING_LIVE_ENABLED` | `false` | `apps/api/src/config/env.ts` | [#billing-collection](#billing-collection) |
| `EXECUTION_ENABLED` | `false` | sandbox orchestration only; production-locked processes cannot enable it | not a live-funds flag |
| Per-corridor live row | disabled | `POST /api/v1/ops/live-enablement` | corridor sections below |
| Per-partner live row | disabled | same | [#partners](#partners) |
| Region kill switch | off | `POST /api/v1/ops/routing/overrides` `kind: region` | [#region-kill-switch](#region-kill-switch) |

Live conversion **requires** recorded sign-off metadata: `approvedBy`, `licenseBasis`,
`approvedAt`, `expiresAt`, and `checklistRef` equal to the anchor of the matching section.
Missing metadata keeps the path in **sandbox**. Expired `expiresAt` auto fail-closes even if
the row is still marked enabled.

`fundsMoved`, `custody`, `transferSigned`, and `meridianKeysUsed` stay **false**. This checklist
does not authorise Meridian to hold customer funds or to execute as principal.

---

## Shared legal premises (every corridor)

Complete **all** of the following outside this repository before any corridor live row is treated
as more than an auditable record:

1. Named licensed partner of record for that corridor (quoting **and**, separately, settlement).
2. Written legal opinion on Meridian’s regulatory position in each touched jurisdiction.
3. Platform-level AML/CFT programme of record (not only customer KYB).
4. Transaction monitoring and suspicious-activity reporting path.
5. Incident / rollback runbook for a real-money failure.
6. `PARTNER_LIVE_ENABLED=true` only after (1)–(5), **and** a live adapter actually exists.

Until those exist, `evaluateLiveFundsMovement` reports `liveFundsMovementActive: false` and
`live_adapters_not_implemented`.

---

## Korea-touching corridors — 외국환 / 특금 / 전자금융

Corridors that send or receive **KRW** additionally require confirmation, **outside Cursor**, of:

- **Foreign exchange (외국환거래법)** — whether the activity is a regulated FX business or is
  fully delegated to a licensed FX institution, and which entity faces the customer.
- **Specified Financial Information Act (특정 금융거래정보의 보고 및 이용 등에 관한 법률, 특금법)** —
  AML/CFT, CDD, STR, and virtual-asset related duties if any stablecoin rail is in scope.
- **Electronic Financial Transactions Act (전자금융거래법)** — whether any electronic payment,
  transfer, or settlement service is being provided by Meridian (it must not be) versus the
  licensed partner.

Do not mark a KRW corridor live by inventing a licence number in code.

### USD→KRW {#usd-krw}

Checklist ref: `GO_LIVE_CHECKLIST.md#usd-krw`

- [ ] Partner of record named for USD→KRW settlement (not quoting only)
- [ ] US money-transmission / MSB position recorded (or written “not applicable, partner is the MSB”)
- [ ] KR 외국환 확인
- [ ] KR 특금 확인
- [ ] KR 전자금융 확인
- [ ] Corridor daily / per-transaction caps agreed
- [ ] Licence or opinion `expiresAt` recorded; calendar reminder for renewal
- [ ] Region kill switch owner identified (`region:US` and `region:KR`)

### KRW→USD {#krw-usd}

Checklist ref: `GO_LIVE_CHECKLIST.md#krw-usd`

- [ ] Same Korea items as USD→KRW (외국환 / 특금 / 전자금융), outbound KRW
- [ ] Same US MSB / partner-of-record items
- [ ] Partner of record named for KRW→USD settlement
- [ ] Licence `expiresAt` recorded

### EUR→KRW {#eur-krw}

Checklist ref: `GO_LIVE_CHECKLIST.md#eur-krw`

- [ ] EU/EEA payment-institution or EMI partner of record (or written “partner holds the licence”)
- [ ] KR 외국환 / 특금 / 전자금융 확인
- [ ] Cross-border FX registration if required in either region
- [ ] Licence `expiresAt` recorded

### KRW→EUR {#krw-eur}

Checklist ref: `GO_LIVE_CHECKLIST.md#krw-eur`

- [ ] Same Korea items as EUR→KRW
- [ ] EU/EEA licence or partner-of-record for inbound EUR
- [ ] Licence `expiresAt` recorded

---

## Other listed corridors

Only these additional pairs may be live-enabled. Each still needs a named partner and a written
opinion; none are confirmed as of 2026-09-02.

### USD→EUR {#usd-eur}

Checklist ref: `GO_LIVE_CHECKLIST.md#usd-eur`

- [ ] US MSB / money-transmission position
- [ ] EU/EEA PI or EMI partner of record
- [ ] Licence `expiresAt` recorded

### EUR→USD {#eur-usd}

Checklist ref: `GO_LIVE_CHECKLIST.md#eur-usd`

- [ ] Same as USD→EUR in reverse
- [ ] Licence `expiresAt` recorded

### USD→JPY {#usd-jpy}

Checklist ref: `GO_LIVE_CHECKLIST.md#usd-jpy`

- [ ] US MSB position
- [ ] Japan funds-transfer / banking partner of record
- [ ] Licence `expiresAt` recorded

### JPY→USD {#jpy-usd}

Checklist ref: `GO_LIVE_CHECKLIST.md#jpy-usd`

- [ ] Same as USD→JPY in reverse
- [ ] Licence `expiresAt` recorded

### USD→GBP {#usd-gbp}

Checklist ref: `GO_LIVE_CHECKLIST.md#usd-gbp`

- [ ] US MSB position
- [ ] UK FCA authorised EMI / payment institution partner of record
- [ ] Licence `expiresAt` recorded

### GBP→USD {#gbp-usd}

Checklist ref: `GO_LIVE_CHECKLIST.md#gbp-usd`

- [ ] Same as USD→GBP in reverse
- [ ] Licence `expiresAt` recorded

Any other pair (for example `USD|NGN`) has **no section** and the API refuses live enablement.

---

## Partners {#partners}

Checklist ref: `GO_LIVE_CHECKLIST.md#partners`

Per-partner live rows require the same sign-off fields. `licenseBasis` must name **that**
partner’s licence, not a generic placeholder.

- [ ] Legal entity of the partner
- [ ] Licence type and number (or regulator register URL)
- [ ] Corridors the licence actually covers
- [ ] Contractual right to instruct settlement (distinct from quoting)
- [ ] `expiresAt` of the licence; evaluation fail-closes at expiry
- [ ] Credential stored only in the PHASE 38 vault, never on `providers`

No live execution-partner adapter is registered in this repository. Enabling a partner row
does not admit an adapter.

---

## Billing collection {#billing-collection}

Checklist ref: `GO_LIVE_CHECKLIST.md#billing-collection`

`BILLING_LIVE_ENABLED` (default **false**) gates **real collection**, live **subscription**
charging, and **partner payouts**. Until the flag is on **and** this section is satisfied,
invoices are **record-only** (`collectionStatus: uncollected`). See `docs/COMPLIANCE.md`
PHASE 35 / PHASE 36.

- [ ] Legal entity that issues invoices / collects payment (today stored as `unconfirmed`)
- [ ] Tax/VAT/sales-tax position **or** an explicit signed “tax remains 0” decision
- [ ] Named processor **or** audited bank-transfer-only confirmation process
- [ ] Subscription / pricing-tier decision (or explicit “no subscription product”)
- [ ] Partner payout model: contracted partners, AP terms, send rail — **not** a custodial
      payable wallet on Meridian
- [ ] Sign-off row `scope=billing` `scopeKey=platform` with current `expiresAt`

`POST /api/v1/ops/billing/collect`, `/ops/billing/subscriptions/run`, and
`/ops/billing/partner-payouts/run` refuse when the flag is off, when sign-off is missing or
expired, when the legal entity is unconfirmed, or when no collection adapter exists. They
never write `collected` or create a partner balance in this tree.

---

## Ad-valorem pricing {#pricing-ad-valorem}

Checklist ref: `GO_LIVE_CHECKLIST.md#pricing-ad-valorem`

`AD_VALOREM_PRICING_ENABLED` (default **false**) gates every charge expressed as a percentage of
transaction notional — `markupBps` and the infrastructure surcharge. The risk is
characterisation: a fee that scales with the amount of money routed can be read as
intermediation economics rather than software licensing, which is a different regulatory
question than the one SELVO has answered.

- [ ] Written legal determination that a percentage-of-notional software fee is not
      money-transmission or intermediation revenue in the named jurisdiction
- [ ] Jurisdiction the determination was written for (`AD_VALOREM_JURISDICTION`)
- [ ] `AD_VALOREM_LEGAL_OPINION_ID` set, and the same id named in this row’s `licenseBasis`
- [ ] Customer contract language covering a percentage fee
- [ ] Sign-off row `scope=pricing_ad_valorem` `scopeKey=platform` with current `expiresAt`

Config load rejects `AD_VALOREM_PRICING_ENABLED=true` without the opinion id and jurisdiction.
Container start additionally rejects it in production without this row. While it is closed,
`markupBps` and the surcharge are stripped before pricing, so the shape contributes zero.

---

## Gain-share pricing {#pricing-gain-share}

Checklist ref: `GO_LIVE_CHECKLIST.md#pricing-gain-share`

`GAIN_SHARE_ENABLED` (default **false**) gates `partnerCommissionMinorUnits` — a share of SELVO
platform revenue or of the savings a route produced. This is the **highest-risk** shape in §18.3:
sharing in the customer’s economic outcome is the hardest thing to characterise as software.

- [ ] Written legal determination on revenue/savings sharing in the named jurisdiction
- [ ] Jurisdiction the determination was written for (`GAIN_SHARE_JURISDICTION`)
- [ ] `GAIN_SHARE_LEGAL_OPINION_ID` set, and the same id named in this row’s `licenseBasis`
- [ ] Referral/partner agreement that actually obliges the payout, with the payer named
- [ ] Confirmation that the payout is an accounts-payable obligation, **not** a custodial
      balance held on behalf of the partner
- [ ] Sign-off row `scope=pricing_gain_share` `scopeKey=platform` with current `expiresAt`

While the shape is closed, commission is zeroed on read as well as on write, and no partner
payout line appears in revenue reporting. Rows written before the gate existed are reported as
zero rather than as revenue, because the commission they carry was never contractually owed.

---

## TPV pricing {#pricing-tpv}

Checklist ref: `GO_LIVE_CHECKLIST.md#pricing-tpv`

`TPV_PRICING_ENABLED` (default **false**) gates pricing driven by total payment volume rather
than by decisions served. Volume-of-money pricing carries the same characterisation risk as
ad valorem, on a monthly aggregate instead of a single transaction.

- [ ] Written legal determination on volume-based pricing in the named jurisdiction
- [ ] Jurisdiction the determination was written for (`TPV_JURISDICTION`)
- [ ] `TPV_LEGAL_OPINION_ID` set, and the same id named in this row’s `licenseBasis`
- [ ] Definition of “volume” that does not imply SELVO handled the funds
- [ ] Sign-off row `scope=pricing_tpv` `scopeKey=platform` with current `expiresAt`

---

## Region kill switch {#region-kill-switch}

Operator `kind: region` overrides (`region:KR`, `region:US`, `region:EU`, …) fail-close:

- live evaluation for every corridor that touches that region
- ranking/quotes for those corridors (same choke point as provider/corridor kill switches)

Licence expiry is **automatic** fail-close on evaluation; it does not wait for an operator to
engage the kill switch. The region switch is the human incident control.

---

## What this file does not do

- It does not lift `executeTransactions` or `delegateExecution`.
- It does not authorise custody, keys, or principal trading.
- It does not replace counsel. Inventing a licence in a coding session is forbidden.
