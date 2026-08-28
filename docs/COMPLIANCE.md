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
| **API keys never store plaintext**                             | `ApiKey.secretHash` is a per-key salted scrypt digest (`hashCredential`). The secret is shown once. Request logs redact `X-Api-Key`, `Authorization`, passwords, tokens, wallets and private keys. |
| **No delegated execution yet**                                 | Distinct from principal trading: instructing a licensed partner is a future capability (`delegateExecution: false`). The 501 is the placeholder for that gate, not a missing feature. The refusal is audit-logged and tested.          |
| **No DeFi execution**                                          | `defiExecution` is false. `defiQuotes` and `defiLiquidityRouting` are true: demo DEX, AMM and aggregator venues return read-only quotes. No adapter is registered as a `RouteProvider`. No swaps, wraps, bridges, keys or wallets. `POST /api/v1/defi-routes` ranks quotes only; `executable` and `swapSubmitted` are always false. The route graph walks indicative edges only. |
| **No stablecoin custody**                                      | `stablecoinRouting` is true: quotes for USDC/USDT name a chain but never open an RPC. `holdCryptoAssets`, `holdPrivateKeys` and `controlCustomerWallets` remain false. There is no wallet, mint, burn or balance. |
| **No AI-agent real payment execution**                         | `agentPayments`, `agentPaymentSimulation`, `agentNaturalLanguageRouting` and `paymentPolicyEngine` are true: agents create intents, interpret natural language, quote, select, receive policy approval and run the sandbox simulator. The policy engine is fail-closed and runs before an execution intent is recorded. The NL parser never computes rates, fees, slippage or settlement amounts. `SIMULATION_COMPLETED` is simulated. `fundsMoved` stays false. Principals of kind `agent` (`mag_` credentials) still act *for* an organization. Wallet references are external handles; `controlledByPlatform` is always false. `POST /executions` remains 501. |
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
and NL route completed, `monetization.recorded`. The audit repository exposes no update or delete operation.

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
