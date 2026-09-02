/**
 * Machine-readable statement of what this deployment will and will not do.
 *
 * Kept in core so the API, the docs and the tests cannot drift. Adding a true capability here is a
 * product decision, not a refactor.
 */
export const PLATFORM_CAPABILITIES = {
  compareRoutes: true,
  /** Execute as principal. Always false: Meridian is not the transacting party. */
  executeTransactions: false,
  /**
   * Instruct a licensed partner to settle on the caller's behalf. False until the compliance gate
   * in docs/COMPLIANCE.md is satisfied. Distinct from `executeTransactions`.
   */
  delegateExecution: false,
  custodyFunds: false,
  holdCryptoAssets: false,
  holdPrivateKeys: false,
  controlCustomerWallets: false,
  operateAsPrincipal: false,
  issueStablecoins: false,
  /**
   * AI agents may create payment intents, request quotes, authorize and run the sandbox
   * simulator. They still cannot move money, hold keys, or settle as principal.
   */
  agentPayments: true,
  /**
   * Sandbox execution simulator for agent payment intents. `SIMULATION_COMPLETED` means the
   * sandbox finished. Funds never move. Distinct from `executeTransactions`.
   */
  agentPaymentSimulation: true,
  /**
   * AI-facing natural-language routing: interpret an instruction into a structured intent, then
   * run policy + the deterministic routing engine. The interpreter never computes rates, fees,
   * slippage or settlement amounts. Distinct from `executeTransactions`.
   */
  agentNaturalLanguageRouting: true,
  /**
   * Read-only DeFi / multi-asset quotes via the financial provider catalog. Distinct from
   * `defiExecution`: a quote is not a swap.
   */
  defiQuotes: true,
  /** On-chain swaps, wraps or bridging. Depth analysis may be added as read-only later. */
  defiExecution: false,
  /**
   * Multi-rail routing engine: tradfi, stablecoin and DeFi quotes ranked with one deterministic
   * scorer. Distinct from `compareRoutes`, which remains the fiat comparison engine.
   */
  multiRailRouting: true,
  /**
   * Rail health and liquidity observations feed the router. Degraded or dry rails are
   * deprioritized; down rails fail over. Distinct from `executeTransactions`.
   */
  railHealthMonitoring: true,
  /**
   * Multi-objective optimizer (cost, speed, finality, FX rate, slippage, liquidity, compliance)
   * with request-level weights inside a published policy range.
   */
  multiObjectiveRouting: true,
  /**
   * `POST /simulate` returns expected all-in cost, slippage and time distributions from mock or
   * historical quotes. Never executes and never calls a live settlement partner.
   */
  preExecutionSimulation: true,
  /**
   * Graph of assets and venues with constrained multi-hop path discovery. Distinct from live
   * quoting: edges carry indicative cost/liquidity metadata and are never executable.
   */
  routeGraph: true,
  /**
   * Stablecoin routing layer: fiat ↔ stablecoin and stablecoin ↔ stablecoin. Distinct from
   * `multiRailRouting` (every rail) and `compareRoutes` (fiat). Quotes name an asset and chain;
   * Meridian never holds the token, opens an RPC, or creates a wallet.
   */
  stablecoinRouting: true,
  /**
   * DeFi liquidity routing layer: DEX, AMM and aggregator quotes, compared with stablecoin and
   * traditional FX routes on the same pair when those providers can price it. Read-only.
   * `defiExecution` stays false: no swap is submitted, no wallet is connected, no key is held.
   */
  defiLiquidityRouting: true,
  /**
   * Versioned financial routing API: `POST /quote`, `POST /routes/search`, catalog GETs, hashed
   * organization API keys with scopes. Distinct from `executeTransactions`.
   */
  financialRoutingApi: true,
  /**
   * Deterministic non-custodial payment policy engine for AI agents. Fail closed.
   * Distinct from `executeTransactions`.
   */
  paymentPolicyEngine: true,
  /**
   * `transaction:create` writes an execution intent (`status: recorded`). Never a submitted
   * payment, swap or payout.
   */
  executionIntents: true,
  /**
   * Multi-rail monetization: TPV, platform revenue, provider cost, partner commission, gross
   * profit and take rate on quoted activity. Decimal only. Distinct from `executeTransactions`.
   */
  multiRailMonetization: true,
  /**
   * Organization-scoped AI-agent financial dashboard. Quoted volume, fees, success rate, spending
   * limits and policy controls. Distinct from `executeTransactions`. No custody, keys or wallets.
   */
  agentFinancialDashboard: true,
  /**
   * Sales-assisted B2B onboarding: invite-only org creation, fail-closed KYB, explicit
   * CustomerPricing. Does not enable execution or licensed quotes by itself.
   */
  b2bOnboarding: true,
  /**
   * Monthly platform-fee invoices generated from persisted monetization snapshots.
   * Payment collection is deferred. Distinct from `executeTransactions`.
   */
  platformInvoicing: true,
  /**
   * Verify and store signed agent mandates (AP2, x402, MPP). HTTP is fail-closed behind
   * MANDATE_INGESTION_ENABLED (default false). Never execution, custody, or private-key holding.
   */
  mandateIngestion: true,
  /**
   * Sandbox execution-partner adapters: Meridian forwards a caller-signed instruction and records
   * partner-reported status. The partner settles to the beneficiary. Live adapters are fail-closed
   * behind PARTNER_LIVE_ENABLED (default false). Distinct from `delegateExecution` (still false).
   * No funds or keys pass through Meridian.
   */
  executionPartnerAdapters: true,
  /**
   * Sandbox orchestration of mandate + selected route against mock execution partners.
   * HTTP is fail-closed behind EXECUTION_ENABLED (default false). Distinct from
   * `executeTransactions` and `delegateExecution` (both still false). Live partners are never called.
   */
  sandboxExecutionOrchestration: true,
  /**
   * Ed25519-signed sandbox execution receipts. HTTP is fail-closed behind EXECUTION_ENABLED.
   * Private key stays in the vault. Payload is hashes and catalog ids, never raw PII.
   */
  verifiableExecutionReceipts: true,
  /**
   * Match dispatched instruction, partner confirmation, and fee attribution. Flags mismatches.
   * HTTP is fail-closed behind EXECUTION_ENABLED. Never moves funds.
   */
  settlementReconciliation: true,
  /**
   * Tenant-scoped audit trail export for owner/admin sessions. Wrong tenant is 404, not 403.
   */
  auditTrailExport: true,
  /**
   * Per-corridor / per-partner / billing live-enablement records with required legal sign-off.
   * Enabling a row does not move funds. Live settlement stays false until adapters exist.
   */
  liveEnablementGates: true,
  /** Live partner settlement of customer funds. Always false in this repository. */
  liveFundsMovement: false,
  /** Processor collection of platform-fee invoices. Always false. */
  liveBillingCollection: false,
  /** Recurring subscription charging. Always false. */
  liveSubscriptionBilling: false,
  /** Partner AP disbursement. Always false. Never a custodial payable balance. */
  livePartnerPayouts: false,
} as const;

export type PlatformCapabilities = typeof PLATFORM_CAPABILITIES;
