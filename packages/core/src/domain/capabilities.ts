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
  /** AI agents requesting quotes or initiating delegated payments. Quotes may be public; initiation is not. */
  agentPayments: false,
  /** On-chain swaps, wraps or bridging. Depth analysis may be added as read-only later. */
  defiExecution: false,
} as const;

export type PlatformCapabilities = typeof PLATFORM_CAPABILITIES;
