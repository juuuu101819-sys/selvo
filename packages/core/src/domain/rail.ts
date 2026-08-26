/**
 * The settlement mechanism a route uses. This is the axis the product compares along, so it is a
 * closed set: adding a rail is a deliberate product decision, not an incidental string.
 */
export const RAIL_TYPES = [
  /** Correspondent banking / SWIFT with a bank's own FX desk. */
  'bank_fx',
  /** Licensed payment institution or EMI with a local-rails payout network. */
  'payment_institution',
  /** Fiat -> regulated stablecoin -> fiat settlement via a licensed partner on both legs. */
  'stablecoin_settlement',
  /** Non-bank wholesale liquidity provider quoting a principal price. */
  'liquidity_provider',
  /** On-chain AMM/orderbook depth. Read-only analysis; see docs/COMPLIANCE.md. */
  'dex_liquidity',
  /** Treasury instruments (money-market, deposit, sweep) used to hold or time a position. */
  'treasury_product',
] as const;

export type RailType = (typeof RAIL_TYPES)[number];

export interface RailDefinition {
  readonly type: RailType;
  readonly label: string;
  readonly description: string;
  /** Whether this rail is priced in the current phase or reserved for a later one. */
  readonly status: 'available' | 'planned';
}

export const RAIL_REGISTRY: Readonly<Record<RailType, RailDefinition>> = {
  bank_fx: {
    type: 'bank_fx',
    label: 'Bank FX',
    description: 'Correspondent banking with the bank acting as FX principal.',
    status: 'available',
  },
  payment_institution: {
    type: 'payment_institution',
    label: 'FX provider',
    description: 'Licensed payment institution settling over local rails.',
    status: 'available',
  },
  stablecoin_settlement: {
    type: 'stablecoin_settlement',
    label: 'Stablecoin partner',
    description:
      'Licensed on-ramp and off-ramp partners settling the middle leg in a regulated stablecoin. ' +
      'Meridian never holds the asset.',
    status: 'available',
  },
  liquidity_provider: {
    type: 'liquidity_provider',
    label: 'Liquidity provider',
    description: 'Wholesale non-bank liquidity provider quoting a principal price.',
    status: 'available',
  },
  dex_liquidity: {
    type: 'dex_liquidity',
    label: 'DEX liquidity',
    description: 'On-chain liquidity depth analysis. Planned, read-only.',
    status: 'planned',
  },
  treasury_product: {
    type: 'treasury_product',
    label: 'Treasury product',
    description: 'Treasury instruments for holding or timing a currency position. Planned.',
    status: 'planned',
  },
};

export function isRailType(value: unknown): value is RailType {
  return typeof value === 'string' && (RAIL_TYPES as readonly string[]).includes(value);
}
