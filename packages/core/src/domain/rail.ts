/**
 * The settlement mechanism a route uses. This is the axis the product compares along, so it is a
 * closed set: adding a rail is a deliberate product decision, not an incidental string.
 *
 * Rails group into three families — traditional finance, stablecoin finance, and DeFi liquidity —
 * which is the product's top-level map of the market. A comparison may filter by rail, by family,
 * or both; the engine still sees a list of rails.
 */

export const RAIL_FAMILIES = ['tradfi', 'stablecoin', 'defi'] as const;
export type RailFamily = (typeof RAIL_FAMILIES)[number];

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

export interface RailFamilyDefinition {
  readonly id: RailFamily;
  readonly label: string;
  readonly description: string;
  /** A family is available when at least one of its rails is currently priced. */
  readonly status: 'available' | 'planned';
}

export const RAIL_FAMILY_REGISTRY: Readonly<Record<RailFamily, RailFamilyDefinition>> = {
  tradfi: {
    id: 'tradfi',
    label: 'Traditional finance',
    description: 'FX desks, correspondent banks, licensed payment institutions and wholesale LPs.',
    status: 'available',
  },
  stablecoin: {
    id: 'stablecoin',
    label: 'Stablecoin finance',
    description:
      'Licensed on-ramp, off-ramp and stablecoin settlement. Meridian never holds the asset.',
    status: 'available',
  },
  defi: {
    id: 'defi',
    label: 'DeFi liquidity',
    description:
      'DEX, AMM and aggregator depth. Read-only quoting is planned; execution is out of scope.',
    status: 'planned',
  },
};

export interface RailDefinition {
  readonly type: RailType;
  readonly family: RailFamily;
  readonly label: string;
  readonly description: string;
  /** Whether this rail is priced in the current phase or reserved for a later one. */
  readonly status: 'available' | 'planned';
}

export const RAIL_REGISTRY: Readonly<Record<RailType, RailDefinition>> = {
  bank_fx: {
    type: 'bank_fx',
    family: 'tradfi',
    label: 'Bank FX',
    description: 'Correspondent banking with the bank acting as FX principal.',
    status: 'available',
  },
  payment_institution: {
    type: 'payment_institution',
    family: 'tradfi',
    label: 'FX provider',
    description: 'Licensed payment institution settling over local rails.',
    status: 'available',
  },
  stablecoin_settlement: {
    type: 'stablecoin_settlement',
    family: 'stablecoin',
    label: 'Stablecoin partner',
    description:
      'Licensed on-ramp and off-ramp partners settling the middle leg in a regulated stablecoin. ' +
      'Meridian never holds the asset.',
    status: 'available',
  },
  liquidity_provider: {
    type: 'liquidity_provider',
    family: 'tradfi',
    label: 'Liquidity provider',
    description: 'Wholesale non-bank liquidity provider quoting a principal price.',
    status: 'available',
  },
  dex_liquidity: {
    type: 'dex_liquidity',
    family: 'defi',
    label: 'DEX liquidity',
    description: 'On-chain liquidity depth analysis. Planned, read-only. No swaps, no keys.',
    status: 'planned',
  },
  treasury_product: {
    type: 'treasury_product',
    family: 'tradfi',
    label: 'Treasury product',
    description: 'Treasury instruments for holding or timing a currency position. Planned.',
    status: 'planned',
  },
};

export function isRailType(value: unknown): value is RailType {
  return typeof value === 'string' && (RAIL_TYPES as readonly string[]).includes(value);
}

export function isRailFamily(value: unknown): value is RailFamily {
  return typeof value === 'string' && (RAIL_FAMILIES as readonly string[]).includes(value);
}

export function familyOf(rail: RailType): RailFamily {
  return RAIL_REGISTRY[rail].family;
}

/** Available (currently priced) rails in a family. Planned rails are omitted. */
export function availableRailsInFamily(family: RailFamily): readonly RailType[] {
  return RAIL_TYPES.filter(
    (rail) => RAIL_REGISTRY[rail].family === family && RAIL_REGISTRY[rail].status === 'available',
  );
}

/**
 * Collapses an optional rail list and an optional family list into the engine's rail filter.
 *
 * `null` means every registered rail. An empty array means the filters contradict or name only
 * planned rails — the HTTP layer rejects that rather than silently quoting nothing.
 */
export function resolveRailFilter(input: {
  readonly rails?: readonly RailType[] | undefined;
  readonly families?: readonly RailFamily[] | undefined;
}): readonly RailType[] | null {
  const rails = input.rails;
  const families = input.families;
  if (rails === undefined && families === undefined) {
    return null;
  }
  const fromFamilies =
    families === undefined
      ? null
      : families.flatMap((family) => [...availableRailsInFamily(family)]);
  if (rails === undefined) {
    return uniqueRails(fromFamilies ?? []);
  }
  if (fromFamilies === null) {
    return [...rails];
  }
  const allowed = new Set(fromFamilies);
  return rails.filter((rail) => allowed.has(rail));
}

function uniqueRails(rails: readonly RailType[]): readonly RailType[] {
  return [...new Set(rails)];
}
