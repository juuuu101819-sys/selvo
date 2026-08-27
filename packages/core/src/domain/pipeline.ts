/**
 * The routing pipeline.
 *
 * Discover → Quote → Compare → Route → Optimize → Delegate execution.
 *
 * Each stage is a named capability so clients (including future AI agents) can see which steps
 * this deployment actually performs. Delegation is the only stage that would move money, and it
 * is refused until a licensed partner of record exists — see docs/COMPLIANCE.md.
 */

export const ROUTING_STAGE_IDS = [
  'discover',
  'quote',
  'compare',
  'route',
  'optimize',
  'delegate',
] as const;
export type RoutingStageId = (typeof ROUTING_STAGE_IDS)[number];

export interface RoutingStage {
  readonly id: RoutingStageId;
  readonly label: string;
  readonly description: string;
  readonly status: 'available' | 'planned';
}

export const ROUTING_PIPELINE: readonly RoutingStage[] = [
  {
    id: 'discover',
    label: 'Discover',
    description: 'List corridors, rails, families and providers this deployment will price.',
    status: 'available',
  },
  {
    id: 'quote',
    label: 'Quote',
    description: 'Collect pricing primitives from every eligible provider on the corridor.',
    status: 'available',
  },
  {
    id: 'compare',
    label: 'Compare',
    description: 'Derive all-in cost against the same mid-market benchmark for every quote.',
    status: 'available',
  },
  {
    id: 'route',
    label: 'Route',
    description: 'Rank candidates and name a recommended route.',
    status: 'available',
  },
  {
    id: 'optimize',
    label: 'Optimize',
    description: 'Apply caller scoring weights (cost, speed, reliability, slippage, liquidity, risk).',
    status: 'available',
  },
  {
    id: 'delegate',
    label: 'Delegate execution',
    description:
      'Instruct a licensed partner to settle. Not implemented: the platform never holds funds, ' +
      'keys or wallets, and never acts as principal.',
    status: 'planned',
  },
];
