import type { CurrencyCode } from '../money/index.js';

/**
 * Which leg of the transfer a fee is deducted from. Source-side fees reduce the amount that gets
 * converted; destination-side fees reduce what the beneficiary receives. The distinction changes
 * the arithmetic, so it is part of the contract rather than a note.
 */
export type FeeSide = 'source' | 'destination';

export interface FixedFeeComponent {
  readonly kind: 'fixed';
  /** Stable machine code, e.g. `"swift_wire"`. */
  readonly code: string;
  readonly label: string;
  readonly side: FeeSide;
  readonly currency: CurrencyCode;
  /** Integer minor units, as a string. */
  readonly amountMinorUnits: string;
}

export interface ProportionalFeeComponent {
  readonly kind: 'proportional';
  readonly code: string;
  readonly label: string;
  readonly side: FeeSide;
  /** Basis points of the amount on the fee's own side of the transfer. */
  readonly rateBps: string;
  /** Optional floor and cap, in minor units of that side's currency. */
  readonly minAmountMinorUnits?: string | null;
  readonly maxAmountMinorUnits?: string | null;
}

export type FeeComponent = FixedFeeComponent | ProportionalFeeComponent;

export interface FeeSchedule {
  readonly components: readonly FeeComponent[];
}

export const EMPTY_FEE_SCHEDULE: FeeSchedule = { components: [] };
