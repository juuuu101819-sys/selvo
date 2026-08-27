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
   * Sandbox execution simulator for agent payment intents. `COMPLETED` means the simulation
   * finished. Funds never move. Distinct from `executeTransactions`.
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
} as const;

export type PlatformCapabilities = typeof PLATFORM_CAPABILITIES;
