/**
 * Canonical product identity.
 *
 * Kept in core so the API meta surface, the docs and the tests cannot describe three different
 * products. Changing `kind` is a product decision, not a copy edit.
 */

export const PRODUCT_KIND = 'global_non_custodial_financial_routing_hub' as const;

export const PRODUCT = {
  kind: PRODUCT_KIND,
  name: 'Meridian',
  positioning:
    'Non-custodial financial routing hub: discover, quote, compare, route and optimize across ' +
    'traditional finance, stablecoin and DeFi liquidity rails. Execution is delegated to licensed ' +
    'or authorized providers; this platform never holds funds or private keys.',
  scope: ['tradfi', 'stablecoin', 'defi', 'fx', 'payments', 'routing'] as const,
  customers: ['businesses', 'licensed_institutions', 'ai_agents_planned'] as const,
  notFor: ['retail_consumers', 'personal_wallets', 'custody', 'principal_trading'] as const,
} as const;

export type ProductKind = typeof PRODUCT_KIND;
export type ProductDefinition = typeof PRODUCT;
