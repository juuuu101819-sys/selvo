# Meridian — Compliance Boundaries

Meridian is a **non-custodial financial routing hub**. It discovers, quotes, compares and ranks
routes; it does not move money. The constraints below are product requirements, and each one is
backed by something in the code rather than by good intentions. Canonical product text:
[MASTER_PRODUCT_DEFINITION.md](./MASTER_PRODUCT_DEFINITION.md).

## Hard boundaries

| Boundary                                                       | Enforcement in code                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No custody of customer funds (fiat or crypto)**              | No wallet, account, balance, ledger or key-management code exists in the repository. There is no data model capable of representing a customer balance. `custodyFunds` and `holdCryptoAssets` are false in `PLATFORM_CAPABILITIES`.    |
| **No private keys, no wallet control**                         | No signing, no keystore, no RPC/on-chain client dependency. `holdPrivateKeys` and `controlCustomerWallets` are false. The `DexLiquidityProvider` port forbids keys and submission even if an adapter is added later.                   |
| **No execution as principal**                                  | There is no outbound payment-initiation call anywhere in the codebase. `executeTransactions` and `operateAsPrincipal` are false. `POST /v1/executions` returns `501 EXECUTION_NOT_IMPLEMENTED`. `transaction:create` writes an execution intent (`status: recorded`); it does not pay. |
| **API keys never store plaintext**                             | `ApiKey.secretHash` is a SHA-256 digest. The secret is shown once. Request logs redact `X-Api-Key`, `Authorization`, passwords, tokens, wallets and private keys. |
| **No delegated execution yet**                                 | Distinct from principal trading: instructing a licensed partner is a future capability (`delegateExecution: false`). The 501 is the placeholder for that gate, not a missing feature. The refusal is audit-logged and tested.          |
| **No DeFi execution**                                          | `defiExecution` is false. `defiQuotes` and `defiLiquidityRouting` are true: demo DEX, AMM and aggregator venues return read-only quotes. No adapter is registered as a `RouteProvider`. No swaps, wraps, bridges, keys or wallets. `POST /api/v1/defi-routes` ranks quotes only; `executable` and `swapSubmitted` are always false. The route graph walks indicative edges only. |
| **No stablecoin custody**                                      | `stablecoinRouting` is true: quotes for USDC/USDT name a chain but never open an RPC. `holdCryptoAssets`, `holdPrivateKeys` and `controlCustomerWallets` remain false. There is no wallet, mint, burn or balance. |
| **No AI-agent payment initiation**                             | `agentPayments` is false. `Principal.economicActor` may be `ai_agent` in the type system; no such principal is issued.                                                                                                                 |
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
stablecoin routing requested/completed/failed, DeFi routing requested/completed/failed, execution rejected, execution intent recorded, API key issued/revoked. The audit repository exposes no
update or delete operation.

## Data handling

Phase 1 stores no personal data: a comparison request is a currency pair, an amount and
optional scoring weights. No beneficiary, payer, account number or identity document is
accepted by any endpoint — the request schemas reject unknown fields, so such data cannot be
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
