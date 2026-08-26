# Meridian — Compliance Boundaries

Meridian is a **decision-support and analytics** platform. The constraints below are product
requirements, and each one is backed by something in the code rather than by good intentions.

## Hard boundaries

| Boundary | Enforcement in code |
| --- | --- |
| **No custody of customer funds** | No wallet, account, balance, ledger or key-management code exists in the repository. There is no data model capable of representing a customer balance. |
| **No execution of real financial transactions** | There is no outbound payment-initiation call anywhere in the codebase. `POST /v1/executions` returns `501 EXECUTION_NOT_IMPLEMENTED`, and the refusal is audit-logged and covered by an integration test. |
| **No holding of crypto assets** | No private keys, no signing, no RPC/on-chain client dependency. Stablecoin rails are priced as *quote data only*. |
| **No stablecoin issuance** | No minting, burning, reserve or attestation logic. |
| **No regulated financial services without a licensed partner** | Every provider descriptor declares a `licensing` posture. Adapters are `unlicensed_sandbox` in Phase 1 and only register in `sandbox` mode. Booting in `production` mode with no licensed adapter configured is a fatal startup error. |

## Quote status

Every quote and comparison the API returns is marked **indicative, non-binding**. Responses
carry `mode` and a `disclaimer`, and the UI surfaces a persistent sandbox banner. Sandbox
pricing is synthetic reference data, not a market feed, and must not be represented to an end
customer as an executable price.

## Audit trail

Financially meaningful events are appended to an immutable audit log with an actor, a timestamp
and a payload: comparison requested, provider quote received, provider quote failed, comparison
completed, comparison replayed, execution rejected. The audit repository exposes no update or
delete operation.

## Data handling

Phase 1 stores no personal data: a comparison request is a currency pair, an amount and
optional scoring weights. No beneficiary, payer, account number or identity document is
accepted by any endpoint — the request schemas reject unknown fields, so such data cannot be
smuggled in.

## Before any Phase 5 (execution) work

All of the following must exist first, and this document must be updated to record them:

1. A licensed partner of record for each corridor to be executed.
2. Legal review of the platform's regulatory position in each operating jurisdiction.
3. KYB/KYC and sanctions screening on every counterparty.
4. Transaction monitoring and suspicious-activity reporting.
5. An explicit written instruction from the product owner to implement execution.

Until then the platform compares routes and hands the customer a recommendation. The customer
transacts with the licensed provider directly.
