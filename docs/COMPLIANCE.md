# Meridian — Compliance Boundaries

Meridian is a **non-custodial financial routing hub**. It discovers, quotes, compares and ranks
routes; it does not move money. The constraints below are product requirements, and each one is
backed by something in the code rather than by good intentions. Canonical product text:
[MASTER_PRODUCT_DEFINITION.md](./MASTER_PRODUCT_DEFINITION.md).

## Hard boundaries

| Boundary                                                       | Enforcement in code                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No custody of customer funds (fiat or crypto)**              | No wallet, account, balance, ledger or key-management code exists in the repository. There is no data model capable of representing a customer balance. `custodyFunds` and `holdCryptoAssets` are false in `PLATFORM_CAPABILITIES`. `packages/core/src/domain/custody-guardrail.test.ts` fails if a balance-like table or field is introduced. |
| **No private keys, no wallet control**                         | No signing, no keystore, no RPC/on-chain client dependency. `holdPrivateKeys` and `controlCustomerWallets` are false. The `DexLiquidityProvider` port forbids keys and submission even if an adapter is added later.                   |
| **No execution as principal**                                  | There is no outbound payment-initiation call anywhere in the codebase. `executeTransactions` and `operateAsPrincipal` are false. `POST /v1/executions` returns `501 EXECUTION_NOT_IMPLEMENTED`. `transaction:create` writes an execution intent (`status: recorded`); it does not pay. |
| **API keys never store plaintext**                             | `ApiKey.secretHash` is a per-key salted scrypt digest (`hashCredential`). The secret is shown once. Request logs redact `X-Api-Key`, `Authorization`, passwords, tokens, wallets and private keys. |
| **No delegated execution yet**                                 | Distinct from principal trading: instructing a licensed partner is a future capability (`delegateExecution: false`). The 501 is the placeholder for that gate, not a missing feature. The refusal is audit-logged and tested.          |
| **No DeFi execution**                                          | `defiExecution` is false. `defiQuotes` and `defiLiquidityRouting` are true: demo DEX, AMM and aggregator venues return read-only quotes. No adapter is registered as a `RouteProvider`. No swaps, wraps, bridges, keys or wallets. `POST /api/v1/defi-routes` ranks quotes only; `executable` and `swapSubmitted` are always false. The route graph walks indicative edges only. |
| **No stablecoin custody**                                      | `stablecoinRouting` is true: quotes for USDC/USDT name a chain but never open an RPC. `holdCryptoAssets`, `holdPrivateKeys` and `controlCustomerWallets` remain false. There is no wallet, mint, burn or balance. |
| **No AI-agent real payment execution**                         | `agentPayments`, `agentPaymentSimulation`, `agentNaturalLanguageRouting` and `paymentPolicyEngine` are true: agents create intents, interpret natural language, quote, select, receive policy approval and run the sandbox simulator. The policy engine is fail-closed and runs before an execution intent is recorded. The NL parser never computes rates, fees, slippage or settlement amounts. `SIMULATION_COMPLETED` is simulated. `fundsMoved` stays false. Principals of kind `agent` (`mag_` credentials) still act *for* an organization. Wallet references are external handles; `controlledByPlatform` is always false. `POST /executions` remains 501. |
| **Signed mandate ingestion is not custody or execution**       | `mandateIngestion` is true (code exists). HTTP is fail-closed behind `MANDATE_INGESTION_ENABLED` (default false). Meridian verifies ECDSA P-256 + SHA-256 proofs and stores the authorization record (`mdt_`). It does not generate keys, hold `d`, custody funds, or execute. Test-only key generation lives in `packages/core/src/mandates/test-keys.ts` and is never on the HTTP path. `holdPrivateKeys` stays false. Spend cap is a limit, not a balance. `POST /executions` remains 501. |
| **Quoted revenue is not money collected**                      | `multiRailMonetization` is true. The revenue dashboard attributes TPV, platform routing fees, provider cost, partner commission, gross profit and take rate on quoted activity. `fundsMoved` / `custody` / `realExecution` stay false. There is no cash ledger, payout rail, or settlement of partner commission. |
| **Agent financial dashboard is not custody**                   | `agentFinancialDashboard` is true. Operators inspect volume, fees, success rate, spending limits and policy denials, and may patch allow-lists. The dashboard never generates a wallet, stores a private key, or moves funds. `fundsMoved` / `custody` / `walletsGenerated` / `privateKeysHeld` stay false. |
| **No stablecoin issuance**                                     | No minting, burning, reserve or attestation logic. `issueStablecoins` is false.                                                                                                                                                        |
| **No regulated financial services without a licensed partner** | Every provider descriptor declares a `licensing` posture. Adapters are `unlicensed_sandbox` in Phase 1 and only register in `sandbox` mode. Booting in `production` mode with no licensed adapter configured is a fatal startup error. |
| **No investment guarantees**                                   | Every quote is marked indicative and non-binding. Responses carry `mode` and a disclaimer. Sandbox pricing is synthetic reference data.                                                                                                |

## Quote status

Every quote and comparison the API returns is marked **indicative, non-binding**. Responses
carry `mode` and a `disclaimer`, and the UI surfaces a persistent sandbox banner. Sandbox
pricing is synthetic reference data, not a market feed, and must not be represented to an end
customer as an executable price.

## Audit trail

Financially meaningful events are appended to an immutable audit log with an actor, a timestamp
and a payload: comparison requested, provider quote received, provider quote failed, comparison
completed, comparison replayed, routing requested/completed/failed, graph requested/completed/failed,
stablecoin routing requested/completed/failed, DeFi routing requested/completed/failed, execution
rejected, execution intent recorded, execution intent rejected (expired quote), API key issued/revoked, agent issued/revoked, payment intent
lifecycle, `payment.policy.evaluated` (every allow and deny), `payment.policy.denied`, NL interpret
and NL route completed, `monetization.recorded`, `onboarding.organization.created`,
`onboarding.invite.issued`, `onboarding.invite.accepted`, `onboarding.kyb.submitted`,
`onboarding.kyb.reviewed`, `onboarding.pricing.configured`, `billing.invoice.issued`,
`billing.revenue.recognized`, `routing.override.engaged`, `routing.override.released`,
`provider.credential.stored`, `organization.execution_authorization.updated`,
`agent.execution_authorization.updated`, `mandate.verified`, `mandate.rejected`,
`mandate.revoked`. The audit repository exposes no update or delete operation.

## Data handling

Phase 1 stores no personal data: a comparison request is a currency pair, an amount and
optional scoring weights. No beneficiary, payer, account number or identity document is
accepted by the comparison/quote schemas — those request schemas reject unknown fields, so such data cannot be
smuggled in. Signed mandates may list **beneficiary codes** (for example `merchant-x`) as
authorization constraints bound to a `mag_` agent. That is not a payout instruction, not an
account number, and not a wallet Meridian controls.
smuggled in.

## Before any delegated-execution (Phase 7) work

All of the following must exist first, and this document must be updated to record them:

1. A licensed partner of record for each corridor to be executed.
2. Legal review of the platform's regulatory position in each operating jurisdiction.
3. KYB/KYC and sanctions screening on every counterparty.
4. Transaction monitoring and suspicious-activity reporting.
5. An explicit written instruction from the product owner to implement **delegated** execution.

Until then the platform compares routes and hands the caller a recommendation. The caller transacts
with the licensed provider directly. Meridian does not become the transacting party.

## Before any live licensed-quote adapter (Phase 5 / PHASE 30)

Read-only quoting against a real licensed API is a **separate** gate from delegated execution.
`POST /api/v1/executions` stays 501 either way. The following must be recorded here **before** an
adapter is written — inventing a partner, wrapping a sandbox feed, or relabelling a demo adapter as
`licensed_partner` is forbidden (PA-C01).

As of 2026-08-28 this gate is **not satisfied**. No licensed provider or partner of record has been
confirmed outside the coding session. Therefore:

| Required confirmation | Status |
| --------------------- | ------ |
| Named licensed provider / partner of record | **Missing** |
| Contractual right to call their quoting API (sandbox and/or production) | **Missing** |
| Scope: quoting only vs quoting + future execution | **Missing** — even if their API can execute, this phase would implement quoting only |
| Credential source (`PROVIDER_<ID>_*` via staging/production secret store) | **Not issued** |
| Corridors / rails in scope | **Not designated** |

Staging and production remain empty of licensed adapters. Comparisons in those environments return
**422** (`UNSUPPORTED_CORRIDOR` / `NO_ROUTES_AVAILABLE`). `PRODUCTION_ROUTING_AVAILABLE` must stay
`false`. Do not set it true to “try” an unconfirmed partner.

## B2B KYB (PHASE 31) — vendor not confirmed

Onboarding a real organization does not change the non-custodial architecture: customer assets
never touch the platform. It also does not enable execution.

As of 2026-08-28 no KYB vendor is contractually confirmed. The flow is implemented anyway, fail
closed:

| Required confirmation | Status |
| --------------------- | ------ |
| Named KYB vendor / provider of record | **Missing** |
| Contractual right to submit businesses for verification | **Missing** |
| Automated approve/reject webhook | **Not implemented** — would be a `KybVendor` adapter |

Interim mechanism: the organization owner/admin submits KYB (`unverified` → `pending`); an internal
operator records `verified` or `rejected` with an audited reason. `ManualReviewKybVendor.submitForReview`
always returns `pending`. A vendor error leaves the org **unverified** — never verified.

Unverified and rejected orgs may explore sandbox quotes. They are not `realTransactionEligible`.
Production-locked licensed quotes additionally require an explicit `CustomerPricing` row (no silent
default take-rate). `POST /api/v1/executions` remains 501.

## Platform-fee invoicing (PHASE 32) — collection not confirmed

Issuing an invoice for quoted platform fees is not customer-transaction settlement and does not
move funds. Legal entity, tax treatment, and payment collection were **not confirmed** outside this
codebase:

| Required confirmation | Status |
| --------------------- | ------ |
| Legal entity that issues invoices / collects payment | **Missing** — stored as `unconfirmed` |
| Tax/VAT/sales-tax rules for the first customer cohort | **Missing** — tax line always 0 |
| Payment collection mechanism | **Missing** — `DeferredPlatformFeeCollector`; no credentials stored |

`realizedRevenue` stays false on invoiced snapshots until a confirmed collection adapter writes
`collected`. `POST /api/v1/executions` remains 501.

## PHASE 35 — do not collect platform-fee invoices until the three gates close

PHASE 35 would implement collection for PHASE 32 invoices (processor adapter **or** audited
manual bank-transfer confirmation). The prompt is a **business + legal decision gate**: do not run
in Cursor until **all three** confirmations exist **outside** this session.

As of 2026-08-29 this gate is **not satisfied**. Therefore PHASE 35 was **not implemented**.
Invoices stay `uncollected`. `issuerLegalEntity` stays `unconfirmed`. Tax stays `0` as a documented
gap, not as an implemented tax engine.

| Confirmation | Status (2026-08-29) | Why it is required |
| ------------ | ------------------- | ------------------ |
| Legal entity that issues invoices / collects payment | **Missing** — still stored as `unconfirmed`. Inventing an entity name in code would misrepresent who is billing. | Invoices name an issuer. An unconfirmed issuer must not start taking payment. |
| Tax/VAT/sales-tax rules **or** an explicit “tax out of scope, remain 0” decision recorded here | **Missing** as a *confirmed* out-of-scope decision. The current `0` is PHASE 32’s deferral, not a signed tax position. | Guessing a rate is a tax implementation. Leaving `0` without the explicit PHASE 35 confirmation is the fail-closed default. |
| Named contracted processor **or** explicit bank-transfer-only / manual-confirmation decision | **Missing.** No Stripe, Toss, KCP, or other processor of record. No written “wires only” decision. | The adapter shape depends on this. Building a fake processor or a generic “charge” endpoint would be a second billing path invented in Cursor. |

**If any of the three is not confirmed, do not run PHASE 35.** Continue operating with
`DeferredPlatformFeeCollector`. That is the state after this session: no collection adapter, no
webhook, no operator “mark collected” endpoint, no `realizedRevenue: true` from payment.

Invariant ② (Route View ≠ … ≠ Verified Settlement ≠ Realized Revenue) still forbids marking
platform-fee revenue realized because a processor call “didn’t error.”

## PHASE 36 — do not add subscriptions or partner payouts until the three gates close

PHASE 36 would add recurring subscription billing and/or a partner-payout engine on top of PHASE 32
invoices (PA-M09 remainder). The prompt is a **business decision gate**: implement only the
confirmed parts; if models are unconfirmed, defer them rather than inventing tiers or partners.

PHASE 35 collection was **deferred** (see above). As of 2026-08-29 the remaining two product
confirmations are **not satisfied**. Therefore PHASE 36 was **not implemented**. Partner commission
stays an attributed field on monetization snapshots. There is no recurring plan catalog and no
payout ledger.

| Confirmation | Status (2026-08-29) | Why it is required |
| ------------ | ------------------- | ------------------ |
| Subscription / pricing tiers **or** an explicit “no subscription model” decision | **Missing.** `enterprise_subscription` is a seeded snapshot type that PHASE 32 can invoice; it is not a confirmed monthly plan catalog, proration policy, or replacement for per-route take-rate. | Inventing tiers would be a second pricing path on top of PA-H10 volume-driven take-rate (invariant ④). |
| Partner payout model: contracted partners, AP commission structure, and send mechanism (processor / wire / manual) | **Missing.** `priceMonetization` attributes 25% of platform revenue as `partnerCommissionMinorUnits`. No named referral partners of record, no AP contract, no payout rail. | Attribution is not accounts payable. Building `PENDING_DISBURSEMENT` rows without partners of record would invent payable balances. |
| PHASE 35 collection live **or** an explicit “calculate but never disburse / never mark payable” decision against **collected** revenue | **Missing as a payout policy.** PHASE 35 was not run: invoices stay `uncollected`. Nothing is collected, so nothing is disbursable. | `Commission Calculated ≠ Commission Payable ≠ Commission Disbursed`. Payable requires collected platform revenue. Fabricating payable or disbursed rows would violate invariant ②. |

**If the models are not confirmed, do not run PHASE 36.** Continue operating with PHASE 32 invoice
generation and PHASE 17 commission *attribution*. That is the state after this session: no
subscription engine, no payout ledger, no partner custodial balance, no dashboard subscription or
payout history. PA-M09 remains **PARTIAL** (invoices only).

Do not invent a plan SKU, a referral partner row, or an in-platform AP wallet to “try” disbursement.
A payout ledger that held spendable partner funds would be a custody violation (invariant ③).

## Before any live execution / AI-agent payment pilot (Phase 5 / PHASE 33)

PHASE 33 (roadmap item 21) would lift `POST /api/v1/executions` off its 501 gate for a **narrow,
allowlisted** pilot. The prompt itself is a **business + legal decision gate**: do not run in
Cursor until **all four** of the following are confirmed **outside** this session.

As of 2026-08-28 this gate is **not satisfied**. Therefore PHASE 33 was **not implemented**. The
501 remains the production control.

| Confirmation | Status (2026-08-28) | Why it is required |
| ------------ | ------------------- | ------------------ |
| The licensed provider integrated in PHASE 30 **explicitly covers execution**, not just quoting | **Missing.** PHASE 30 never named a partner of record; the licensed registry is empty; there is no execution adapter to extend. Read-only quoting and real-money execution are typically **separate contractual/regulatory scopes**. | Calling a quoting API is not authorization to move funds. |
| **Compliance/regulatory sign-off** for enabling real execution in the relevant jurisdictions (money-transmission licensing, AML/KYC beyond PHASE 31 KYB, corridor-specific financial regulation) | **Missing.** PHASE 31 recorded KYB *process* only; no MSB/MTL, no BSA/AML program of record, no named counsel. | Real execution is a regulated activity. Platform KYB of *customers* does not substitute for the platform's own licenses. |
| **Pilot scope explicitly bounded**: which orgs/agents may execute (allowlist, not a global flag); max transaction size and daily volume; which corridor(s)/rail(s) | **Missing.** No named orgs, agents, caps, or corridors were confirmed outside this session. Inventing a sample allowlist would be a product decision, not an implementation of a confirmed gate. | Unbounded or invented scope is a general launch, not a pilot. |
| **Incident/rollback plan** for a real-money failure (partial execution, provider error after funds moved, reconciliation mismatch) | **Missing.** This is operational readiness, not something a coding session can verify. | Fail-closed code is not a substitute for an ops runbook that humans have agreed to. |

**If any of the four is not confirmed, do not run PHASE 33.** Continue operating with
`/api/v1/executions` at **501**. That is the state after this session: the 501 gate was **not**
lifted; no allowlist table, settlement state machine, provider execution call, or
realized-revenue-from-settlement path was added.

Invariant ③ (customer assets never touch the platform) and invariant ② (Route View ≠ Selection ≠
Execution Intent ≠ External Provider Execution ≠ Verified Settlement ≠ Realized Revenue) remain
untested against real money — by design, until the four gates close.

## PHASE 38 — operator kill switch, credential vault, execution consent flags

PHASE 38 is **readiness plumbing**. It does **not** close PA-M09, lift PHASE 30, or enable PHASE 33.
`POST /api/v1/executions` remains **501**.

| Mechanism | Status |
| --- | --- |
| Manual kill switch (`POST /ops/routing/overrides`) | Live. Same `supportsNormalized` choke point as the quote circuit breaker. No automatic reset. Audited. Visible on `GET /api/v1/meta` as `manualOverrides`. |
| Provider credential vault | Live. AES-256-GCM, write-only HTTP, synthetic-ID tests. PHASE 30 must use this rather than adding columns on `providers`. |
| `Organization.executionAuthorized` / `Agent.executionAuthorized` | Stored, owner/admin-only, audited. **Inert** — execution, eligibility, and quoting do not read these fields. Identity (KYB) is not consent-to-execute. |
| Sandbox UI badge | Comparison, dashboard, explorers, and policy forms show **Sandbox** for `unlicensed_sandbox`. Re-verify both states on one screen when a licensed partner exists. |
| Invariant ③ | `packages/core/src/domain/custody-guardrail.test.ts` fails if a balance-like table or field is introduced. |
| Cross-tenant isolation | `apps/api/src/routes/tenant-isolation.test.ts` walks the OpenAPI catalog. |

These flags currently have **zero functional effect**. They exist so PHASE 33 can consult them later; they do not change quoting, ranking, billing, KYB, or the 501 gate.

## PHASE 39 — pre-launch verification (referral-model MVP)

Verification only. No new capabilities. `POST /api/v1/executions` remains **501**. PHASE 30/33/35/36
remain blocked pending confirmation outside Cursor.

| Check | Result |
| --- | --- |
| PA-C01–C03, PA-H01–H13, PA-M01–M08/M10–M16, PA-L01–L04/L06 | Re-verified FIXED (tests + live sandbox/staging). |
| PA-M09 remainder, PA-L05 | Still deferred / PARTIAL — not launch blockers for quoting + referral attribution. |
| Kill switch, isolation, custody guardrail | Still pass. |
| Positioning copy | Landing/README no longer imply a connected licensed partner. |
| Counsel draft `COMPLIANCE_BOUNDARY_DRAFT.md` | Still absent; this file (`COMPLIANCE.md`) remains the in-repo boundary. |

Full tables and live evidence: [`PRE_LAUNCH_READINESS.md`](./PRE_LAUNCH_READINESS.md).

