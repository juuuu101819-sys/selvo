# Agent Treasury — design exploration (PHASE 37 / roadmap PHASE H)

**Status:** design only. Not implemented. Not an audit finding.  
**Date:** 29 August 2026  
**This document does not authorize code, schema, or API work.** Implementation is a future
phase gated on review of this design **and** answers to [section 5](#5-open-questions-for-businesslegal-review),
the same way PHASE 30 (licensed quoting) and PHASE 33 (execution pilot) are gated on confirmation
in [`COMPLIANCE.md`](./COMPLIANCE.md).

Invariant ③ (PA-C01, re-confirmed every phase since PHASE 0): **customer and agent assets never
touch this platform.** `PLATFORM_CAPABILITIES.custodyFunds`, `holdCryptoAssets`, `holdPrivateKeys`,
`controlCustomerWallets`, and `operateAsPrincipal` are `false`. `AgentWalletReference.controlledByPlatform`
is typed and CHECK-constrained to `false`. There is no data model that can represent a spendable
in-platform balance.

A naive Treasury — an internal ledger an agent draws down — would violate that invariant. This
exploration exists so that architecture is chosen **before** any table or endpoint is added.

---

## What this document is not

- Not the planned comparison rail `treasury_product` (money-market / deposit / sweep instruments
  used to hold or time a **currency position** on a tradfi route). That rail is still `planned` on
  `POST /comparisons` and has no adapter. It is a **pricing product**, not agent spend autonomy.
- Not PHASE 32/35 platform-fee collection, PHASE 36 subscriptions, or partner payouts.
- Not a decision. Section 2 ends with a **recommendation**. Business and legal confirm or reject it.

---

## 1. Problem statement

The numbered “business spec” sections 6 and 19 are not a separate file in this repository. The
canonical product text that those items map onto is
[`MASTER_PRODUCT_DEFINITION.md`](./MASTER_PRODUCT_DEFINITION.md) (long-term AI agent payments,
including “manage treasury”) together with [`AGENTS.md`](./AGENTS.md) and roadmap Phase 14
(AI agent payment infrastructure). PA-L05 records the same gap as deferred product work that
**must not** be built as in-platform balances.

### What exists today (Phase 14–16, PA-H03/H04)

An AI agent is an organization-scoped machine principal (`mag_` credential). It may:

1. Create a payment intent.
2. Quote through the single `MultiRailRouter`.
3. Select a route.
4. Receive fail-closed `PaymentPolicy` approval (max amount, assets, chains, providers, countries,
   recipients, fees, score, liquidity, slippage, daily spend).
5. Run the **sandbox simulator**. `SIMULATION_COMPLETED` is simulated. `fundsMoved` stays `false`.
6. Have an owner/admin record an **execution intent** (`transaction:create`, `status: recorded`).
   `POST /api/v1/executions` remains an audited **501**.

Policy is already the autonomy mechanism for a **single** request. Daily spend is already reserved
atomically (PA-H04): statuses `ROUTED` … `SIMULATION_COMPLETED` consume
`dailySpendingLimitMinorUnits` in `dailySpendingAsset`; `FAILED` / `EXPIRED` release the
reservation; select / authorize / simulate / the execution-intent gate run inside
`withExclusiveAgentAccess`. Empty allow-lists mean **none**, not all.

What the agent **cannot** do today:

- Instruct a licensed provider to move money.
- Spend above the daily cap even if a human would have approved a weekly envelope.
- Point the router at a provider-side sub-account as the source of funds (the issued
  `AgentWalletReference` is a **label** (`ext_acct_*`), not a live funding pointer).
- Receive payments, settle agent-to-agent, or “manage treasury” as a funded program.

### What “Treasury” must accomplish

Pulled from the product definition, not invented:

> AI agents should eventually use the API to request a quote, compare routes, select an optimal
> route, **initiate a payment through an authorized provider**, pay businesses and other AI agents,
> receive payments, convert between fiat and stablecoin rails, and **manage treasury**.
>
> That is a **consumer of the routing hub**, not a second product.  
> — `docs/MASTER_PRODUCT_DEFINITION.md`, “Long-term: AI agent payments”

> Not in this phase: agent-to-agent settlement, **treasury automation**.  
> — same document; restated in `docs/AGENTS.md` gaps

Roadmap Phase 14 already states the intended topology:

```
AI Agent → Financial Router → Financial Rail → External Provider
```

The agent never custodies funds **on this platform**. Funds, if they move at all, move at an
external licensed provider under **delegated** execution (`delegateExecution`), which is still
`false` and 501-gated.

**Precise capability for Agent Treasury (PHASE H):**

An organization’s operator should be able to grant an agent a **standing spending envelope** —
limits that span many payment intents over a chosen period (at least weekly and monthly, in
addition to today’s per-transaction max and daily cap) — so the agent can request repeated
payments **without a human re-approving each intent**, while:

- every intent still passes the existing fail-closed `PaymentPolicy` (PA-H03);
- spend is reserved the same way daily spend is reserved (PA-H04);
- the **source of funds remains entirely outside Meridian** (bank, licensed payment institution,
  or custodian the organization already has);
- Meridian never holds, prefunds, or pays out an agent balance.

Receive-payments, agent-to-agent settlement, and FX “treasury product” quoting are **out of scope
for this design**. They are separate PA-L05 items and would each need their own non-custodial
design. Treasury here is **autonomous outbound spend under policy**, not a wallet product.

---

## 2. Non-custodial architecture options

Every option is scored against invariant ③. “Funds at rest on Meridian” is a fail, not a trade-off.

### Rejected: in-platform spendable balance

**Anything in which Meridian stores a number the agent can draw down as money** — prepaid wallet,
internal float, escrow table, “treasury_balance_minor_units”, partner-style AP wallet reused for
agents, or a ledger that credits deposits and debits payments.

| Invariant ③ | Fail |
| ----------- | ---- |
| Why | That number **is** custody: the platform would be holding customer/agent value, even if the
column is labelled “memo” or “pending.” `COMPLIANCE.md` already states there is no data model
capable of representing a customer balance. PA-L05’s recommended fix is to follow that document,
not to add the missing table. |
| Also fails | Invariant ② (`Route View ≠ … ≠ Verified Settlement ≠ Realized Revenue`): a draw-down would
look like settlement on this platform. `custodyFunds` / `holdCryptoAssets` would have to become
true, which is a product identity change, not a feature flag. |
| Do not implement | Ever, in this architecture. If a future licensed entity *is* a custodian, that is a
different product with a different compliance program — not a PHASE H add-on. |

---

### Option A — Policy-only Treasury (no balance)

**Idea.** “Treasury” is a **higher-level spending envelope** on the existing `PaymentPolicy`:
weekly and monthly caps (and, if confirmed, per-recipient or per-corridor sub-caps) enforced the
same way `dailySpendingLimitMinorUnits` is enforced today. Zero funds on the platform. The agent’s
money stays at the external account the organization already uses. Meridian only authorizes and
(after PHASE 33) **delegates** against that external account.

| | |
| --- | --- |
| **Invariant ③** | **Pass.** No new balance. Reservation rows are *capacity*, not assets — they already exist
for the daily cap (`DAILY_SPENDING_STATUSES`). Extending the window does not create custody. |
| **Reuse** | `PaymentPolicy`, `evaluatePaymentPolicy`, `sumDailySpending`, `withExclusiveAgentAccess`,
`AgentWalletReference` as an unchanged external label. |
| **Fits current code** | Highest. Daily reservation is the prototype. Weekly/monthly are additional
windows on the same locked check-and-reserve. |
| **Depends on PHASE 30/33** | **Enforcement against real money** depends on PHASE 33 (otherwise the
envelope only constrains sandbox simulation, which the daily cap already does). The *shape* of
the policy can be specified now; turning it on for live spend cannot. |
| **Strengths** | Smallest surface; no provider-specific product; no stored funding credentials;
operators already PATCH policy from the agent dashboard. |
| **Weaknesses** | Does not by itself “fund” anything. If operators expected a visible “treasury
balance,” this option refuses that UX on purpose. Multi-asset envelopes are awkward with today’s
single `dailySpendingAsset`. Failed external execution must **release** reserved envelope the
same way `FAILED`/`EXPIRED` release daily spend — that release rule is only meaningful once
execution exists. |
| **New custody risk** | None, if reservation is never treated as a customer liability. |

---

### Option B — External sub-account reference

**Idea.** Meridian stores a **pointer** to a sub-account or connected account at a licensed
provider/custodian (Stripe Connect-style, or a bank virtual-account id). Custody and balance live
**only** at that provider. Meridian’s role is authorization metadata plus routing: “this intent
may be delegated against connected-account `acct_…` if policy allows.”

This is a stricter form of today’s `AgentWalletReference` (`kind: external_account`,
`controlledByPlatform: false`, `externalRef` as a non-secret handle). Today’s row is a **label**
created on agent issuance, not a live funding source.

| | |
| --- | --- |
| **Invariant ③** | **Conditional pass.** Pass only if (1) Meridian never receives, holds, or
sweeps the sub-account balance, (2) API credentials are provider tokens with **authorization
scope**, not withdrawal keys held as if Meridian were the account owner, (3) `controlledByPlatform`
stays `false`, and (4) no platform-side cache of “available balance” is treated as spendable
funds. A copied balance used as a limit would be a **shadow wallet** — reject that. |
| **Reuse** | Extend `AgentWalletReference` (or a 1:1 `TreasuryReference` that *is* a wallet
reference with a provider account id). Do not invent a second wallet type that can store keys. |
| **Depends on PHASE 30/33** | **Hard.** There is no licensed partner of record (PHASE 30 missing).
A Connect-style product is a **named provider capability**, not something this repo can stub.
PHASE 33 must cover execution against that sub-account, not merely quoting. |
| **Strengths** | Matches “initiate a payment through an authorized provider” with a real funding
source; operators can see provider-side balances **in the provider’s UI**, not ours. |
| **Weaknesses** | Storing even a pointer may create regulatory obligations (section 5). Credential
scope is easy to get wrong (a stored secret that can pull funds is operational custody).
Cross-provider envelopes still need Option A’s policy caps. |
| **New custody risk** | High if implemented as “we show the agent’s money here.” Low if the
pointer is opaque and unused until a confirmed PHASE 33 adapter. |

---

### Option C — Pre-authorization / hold at the external provider

**Idea.** For an expected batch of agent spend, Meridian asks the licensed provider to **hold**
or pre-authorize funds (card-style auth, or an equivalent payout hold). Meridian never takes the
money. The provider remains issuer/acquirer/custodian. Each later agent payment captures against
that hold, or the hold expires/releases at the provider.

| | |
| --- | --- |
| **Invariant ③** | **Conditional pass.** Pass only if the hold exists **solely** on the provider’s
books and Meridian stores only the provider’s hold/auth **reference token** (same discipline as
PHASE 35: no raw card or bank credentials). Fail if Meridian records a hold amount as an internal
balance the agent can spend without a provider confirmation. |
| **Reuse** | Not a new policy engine. This is an **execution-adapter** behavior on the PHASE 33
path, gated by existing `PaymentPolicy` before each capture. Reservation (PA-H04) still runs
locally so two intents cannot over-commit the envelope while the provider hold is in flight. |
| **Depends on PHASE 30/33** | **Hardest of A–C.** Requires a contracted processor/rail that
actually offers holds, plus PHASE 33 incident/rollback (partial capture, expired hold, provider
timeout). Ambiguous hold-create must **fail closed** (invariant ②): do not treat “API did not
error” as funds reserved at the provider. |
| **Strengths** | Closest to “treasury float” **without** Meridian float; reduces NSF at capture
time if the provider hold is real. |
| **Weaknesses** | Product- and rail-specific; fiat card holds do not map to stablecoin or DeFi
legs; hold duration vs. weekly envelope mismatch; over-auth and release accounting is an ops
program, not a table. |
| **New custody risk** | Medium: a local “held_minor_units” column that agents spend against is
Option-Rejected in disguise. Only the provider’s hold id is allowed. |

---

### Other options considered (and not chosen as primary)

| Option | Invariant ③ | Note |
| ------ | ----------- | ---- |
| **D. Human approval queue for every intent** | Pass | Already possible by setting tiny daily/max caps. Does **not** meet “without a human
re-approving every transaction.” Not Treasury; it is the absence of Treasury. |
| **E. Stablecoin wallet hosted by Meridian** | Fail | Keys, chain connection, or an omnibus
address would be custody. Forbidden by the non-custodial contract. |
| **F. Platform omnibus + sub-ledgers** | Fail | Classic MTL/custody architecture. Explicitly
rejected. |

---

### Recommendation (not a decision)

**Prefer Option A as the PHASE H architecture**, with Option B as an **optional later pointer**
once a named PHASE 30 provider offers connected accounts and legal has answered the pointer
questions, and Option C as a **provider-adapter tactic inside PHASE 33** — not a platform
Treasury product.

Reasons:

1. It is the only option that can be specified entirely in terms of models this repo already
   treats as canonical (`PaymentPolicy`, PA-H04 reservation).
2. It cannot accidentally become a wallet: there is no balance column to misuse.
3. Options B and C are blocked on the same missing partner-of-record as PHASE 30/33; building
   them now would invent a processor (forbidden).
4. Operators already reason in envelopes (max txn, daily cap). Weekly/monthly is the missing
   autonomy, not a missing bank.

Business/legal may still choose B or C as the *funding* mechanism **under** A’s envelopes. A
without B/C is still Treasury as defined in section 1. B or C without A would still need policy
caps or the agent is unbounded at the provider.

---

## 3. Data model sketch (illustrative, not final)

**Do not migrate from this sketch.** Column names are a proposal for a future implementation
phase after section 5 is answered.

### Principle

Extend `PaymentPolicy` (one row per `(organizationId, agentId)`). Do not create a parallel
policy engine. A separate `TreasuryPolicy` table, if used at all, is a **1:1 extension** of
`PaymentPolicy` with the same uniqueness, not a second evaluator.

`TreasuryReference` is **not** a new wallet. It is today’s `AgentWalletReference` (or a
narrow 1:1 row pointing at one). `controlledByPlatform` remains `false`. No private key, seed,
RPC URL, or balance field — the current TypeScript type **cannot** represent custody; keep it
that way.

### Existing (do not replace)

```
PaymentPolicy
  maxTransactionAmountMinorUnits
  dailySpendingLimitMinorUnits
  dailySpendingAsset
  allowedAssets / allowedRecipientCodes / allowedProviderIds /
  allowedChainIds / allowedCountryCodes
  maxFeeBps, maxSlippageBps, minRouteScore, minLiquidityHeadroom
  preferredRoutePreference

AgentWalletReference
  kind: external_account | external_wallet
  label, externalRef
  controlledByPlatform: false   -- CHECK + type

PaymentIntent statuses that reserve spend (PA-H04)
  ROUTED | POLICY_APPROVED | SIMULATION_PENDING | SIMULATION_COMPLETED
  FAILED | EXPIRED release
```

### Proposed envelope fields (Option A)

Add to `PaymentPolicy` (bigint/`Decimal(38,0)` minor units, same as today):

| Field | Meaning |
| ----- | ------- |
| `weeklySpendingLimitMinorUnits` | Inclusive cap over a rolling or calendar week in `dailySpendingAsset` (or a new `envelopeAsset` if product confirms multi-asset envelopes). `null` = no weekly envelope (daily + max txn still apply). |
| `monthlySpendingLimitMinorUnits` | Same for calendar month (timezone **must** be confirmed; UTC is the PHASE 32 invoice convention and is the default to propose). `null` = no monthly envelope. |
| `envelopeTimeZone` | IANA name or `'UTC'`. Required if calendar windows are used. |

Evaluation in `evaluatePaymentPolicy` (and the locked reserve path):

```
assertMaxTransaction          -- existing
assertDailySpending           -- existing PA-H04
assertWeeklySpending          -- same pattern, wider window
assertMonthlySpending         -- same pattern, wider window
assertAllowed* / fee / route  -- existing
```

Reservation stays a **status-set sum**, not a balance table. `sumDailySpending` becomes a
parameterized `sumSpendingInWindow({ from, to, asset, statuses, excludeIntentId })`. Exclusive
agent lock (`withExclusiveAgentAccess`) stays mandatory so concurrent intents cannot each pass.

**Not a liability account.** The sum of reserved intents is not “treasury funds.” It is “how
much of the operator-granted envelope is already spoken for.”

### Optional `TreasuryReference` (Option B, later)

Only if section 5 allows storing a provider pointer:

```
TreasuryReference  -- 1:1 with AgentWalletReference or extra fields on that row
  providerId              -- catalog / licensed adapter id (not invented)
  providerAccountRef      -- processor token / connected-account id, not an IBAN
  credentialScope         -- enum: quote | delegate_execution  (no withdraw-to-platform)
  controlledByPlatform    -- still false
```

Never store: card PAN, raw account number, wallet seed, provider login password, or a cached
`availableMinorUnits` used as a spend limit.

### Optional hold reference (Option C, later, on the execution adapter)

A hold is an **execution-intent / provider-call** artifact, not a Treasury balance:

```
on ExecutionIntent or a child row (after PHASE 33 exists):
  providerHoldRef     -- token only
  holdStatus          -- requested | confirmed | failed | released | captured
  -- no spendable local amount; amount lives in the provider confirmation
```

Ambiguous hold-create → `failed`, envelope reservation released. Same fail-closed rule as
PHASE 35 collection: **confirmed success only**.

### What must not appear

- `balanceMinorUnits`, `deposits`, `withdrawals`, `agent_accounts`
- Statuses that read as settlement (`AUTHORIZED` in the card sense, `COMPLETED` as funds moved)
  — PA-H13 already banned those on payment intents
- A second ranking engine for “treasury routes”

---

## 4. Interaction with PHASE F / G / H gating

Letter mapping used by this phase’s prompt (not currently lettered in `ROADMAP.md`):

| Letter | Repo phase | Gate | Treasury relationship |
| ------ | ---------- | ---- | --------------------- |
| **F** | PHASE 30 | Named licensed provider; contractual quoting; no fake adapters (PA-C01) | Options B and C **cannot** be implemented. There is no partner of record, empty licensed registry, production-locked quotes 422. Option A’s policy fields do not require a live provider, but they do not move money either. |
| **G** | PHASE 33 | Four confirmations: execution rights (not just quoting), compliance sign-off, bounded pilot (org/agent/corridor/caps), incident/rollback | **Treasury-as-autonomous-payment is an extension of policy over real delegated execution.** Without G, envelopes only constrain simulation — which daily caps already do. Lifting 501 without envelopes would mean live spend with only max-txn + daily policy. |
| **H** | this document | Design + section 5 answers | Must not precede a decision on A/B/C. Must not implement while F and G are unconfirmed **if** the implementation would call a provider or store a funding pointer. |

**Explicit dependency:**

```
PHASE 30 (F)  licensed quoting partner
    →  PHASE 33 (G)  allowlisted delegated execution
        →  PHASE H     Treasury envelopes on that execution path
```

- **Do not implement Treasury execution** (holds, connected-account charges, live envelope
  against real money) before PHASE 33 is confirmed and implemented.
- **Do not treat this design as permission to lift `POST /api/v1/executions`.** PHASE 33’s four
  gates are unchanged.
- **Do not invent a licensed provider** to make Options B/C demoable (PA-C01).
- Option A schema *could* theoretically ship as simulation-only caps before G. That is a
  product choice (section 5, Q11). It is **not** required to wait, but it is also **not**
  “Agent Treasury” in the product-definition sense until payments initiate through an authorized
  provider.

PHASE 31 KYB, PHASE 32 invoicing, PHASE 35 collection, and PHASE 36 payouts are **orthogonal**.
Platform-fee cash is not agent treasury. Mixing them would confuse invariant ② (platform
`realizedRevenue`) with agent spend.

---

## 5. Open questions for business/legal review

Do **not** answer these in a coding session. Record confirmations in `COMPLIANCE.md` (or a
successor legal memo) before any implementation phase.

### Product — what Treasury is

1. Confirm the definition in section 1: standing outbound spend envelope under `PaymentPolicy`,
   **not** a hosted balance, **not** receive-payments, **not** agent-to-agent, **not** the
   `treasury_product` rail. If the desired capability is different, this design does not apply.
2. Confirm Option A as the architecture, or explicitly select B, C, or A+B / A+C. This document
   **recommends A**.
3. Envelope windows: rolling vs calendar; timezone (UTC vs org local); which asset when the
   agent may spend USD and USDC (today’s daily cap is a single `dailySpendingAsset`).
4. Are weekly/monthly caps required for the PHASE 33 pilot, or is the existing daily cap enough
   for the first allowlisted corridor?
5. Human re-approval: is a per-intent approval queue ever required above a threshold, or is
   envelope + policy the entire autonomy model?

### Legal / regulatory — custody and transmission

6. Does a **policy-only envelope** (Option A) change money-transmission or similar licensing
   exposure versus single-transaction delegated execution? (Flag only; do not conclude.)
7. Does storing a **provider sub-account id or connected-account pointer** (Option B) create
   custodial, agency, or data-protection obligations even if Meridian never holds the funds?
8. Does instructing a provider to place a **hold/pre-authorization** (Option C) make Meridian a
   party to the hold, an agent of the payer, or a money transmitter, versus a pure messenger?
9. Are provider API credentials that can **initiate payouts from a customer sub-account**
   treated as controlling that account (`controlCustomerWallets` / operational custody) even
   when `controlledByPlatform` is false in software?
10. KYB/AML: is agent autonomous spend the same risk as a human dashboard user clicking “record
    execution intent,” or does a standing envelope require extra monitoring / SAR / velocity
    rules beyond PHASE 31 org KYB?

### Dependencies on other gates

11. May Option A fields be added while `POST /api/v1/executions` is still 501 (simulation-only
    envelopes), or is all Treasury work blocked until PHASE 33?
12. PHASE 30 partner of record: which licensed provider, if any, will be the funding source for
    Options B/C? (Inventing a name is forbidden.)
13. PHASE 33 pilot bounds: do org/agent allowlist, max transaction, daily volume, and corridor
    **replace** Treasury envelopes, **stack** with them, or is Treasury the way those bounds are
    expressed?
14. Incident/rollback (PHASE 33 gate 4): if an envelope was reserved and the provider execution
    is ambiguous or partial, is the rule “release reservation” (fail closed) or “keep reserved
    until ops confirms”? Legal and ops must pick one; code must not guess.

### Data and operations

15. Is `AgentWalletReference.externalRef` allowed to become a live provider account id, or must
    it remain a non-secret operator label as today?
16. May Meridian **display** a provider-reported balance on the agent dashboard (read-only,
    not used for authorization)? Display-only still needs a legal view on whether that is
    offering an account.
17. Audit: are envelope denials the same `payment.policy.denied` events with new `rule` values
    (`weekly_spending_limit`, `monthly_spending_limit`), or a new event type?
18. Multi-tenant: can two agents in one org share an envelope, or is Treasury strictly
    per-agent like today’s `PaymentPolicy` uniqueness?

---

## Implementation freeze

Until this design is reviewed and the questions in section 5 are answered **outside** a coding
session:

- Do not add Treasury tables, endpoints, dashboard “balance” UI, or capability flags.
- Do not lift `POST /api/v1/executions`.
- Do not store raw payment credentials or in-platform agent balances.
- Do not begin a follow-on implementation pass from this file alone.

`evaluatePaymentPolicy` + PA-H04 daily reservation remain the only spend-autonomy controls in
production code.
