import { ValidationError } from '../errors/index.js';
import { Dec, type Decimal, type DecimalInput, toDecimal } from '../money/index.js';

/**
 * Version of the *multi-rail* routing engine's calculation semantics.
 *
 * Independent of {@link ENGINE_VERSION} (the fiat comparison engine, currently 2.0.0). Bump this
 * when a change would alter routing output for an unchanged input. Do not bump the comparison
 * engine version from here — the two scores are not interchangeable.
 */
export const ROUTING_ENGINE_VERSION = '1.0.0';

/** The factors a multi-rail route is scored on. */
export const ROUTING_SCORING_FACTORS = [
  'cost',
  'speed',
  'liquidity',
  'reliability',
  'settlementConfidence',
] as const;

export type RoutingScoringFactor = (typeof ROUTING_SCORING_FACTORS)[number];

export type RoutingWeights = Readonly<Record<RoutingScoringFactor, Decimal>>;

export interface RoutingWeightsInput {
  readonly cost: DecimalInput;
  readonly speed: DecimalInput;
  readonly liquidity: DecimalInput;
  readonly reliability: DecimalInput;
  readonly settlementConfidence: DecimalInput;
}

export type SerializedRoutingWeights = Readonly<Record<RoutingScoringFactor, string>>;

/**
 * Platform default for the multi-rail router.
 *
 * Cost dominates because it is measured in money. Speed is next because a delay has a financing
 * cost. Liquidity, reliability and settlement confidence break ties rather than overriding a
 * materially cheaper route.
 */
export const DEFAULT_ROUTING_WEIGHTS: SerializedRoutingWeights = {
  cost: '0.45',
  speed: '0.2',
  liquidity: '0.15',
  reliability: '0.1',
  settlementConfidence: '0.1',
};

/**
 * Validates multi-rail scoring weights.
 *
 * They must be non-negative and sum to exactly 1, which keeps scores comparable across requests.
 */
export function parseRoutingWeights(input: RoutingWeightsInput): RoutingWeights {
  const weights = Object.fromEntries(
    ROUTING_SCORING_FACTORS.map((factor) => [factor, toDecimal(input[factor])]),
  ) as RoutingWeights;

  for (const factor of ROUTING_SCORING_FACTORS) {
    const value = weights[factor];
    if (value.isNegative() || !value.isFinite()) {
      throw new ValidationError(`Routing weight "${factor}" must be a non-negative decimal.`, {
        weight: factor,
        value: value.toFixed(),
      });
    }
  }

  const total = ROUTING_SCORING_FACTORS.reduce(
    (sum, factor) => sum.plus(weights[factor]),
    new Dec(0),
  );
  if (!total.equals(new Dec(1))) {
    throw new ValidationError('Routing weights must sum to exactly 1.', {
      ...serializeRoutingWeights(weights),
      sum: total.toFixed(),
    });
  }

  return weights;
}

export function serializeRoutingWeights(weights: RoutingWeights): SerializedRoutingWeights {
  return Object.fromEntries(
    ROUTING_SCORING_FACTORS.map((factor) => [factor, weights[factor].toFixed()]),
  ) as SerializedRoutingWeights;
}

export const defaultRoutingWeights = (): RoutingWeights =>
  parseRoutingWeights(DEFAULT_ROUTING_WEIGHTS);
