import { ValidationError } from '../errors/index.js';
import { Dec, type Decimal, type DecimalInput, toDecimal } from '../money/index.js';

/**
 * Version of the *multi-rail* routing engine's calculation semantics.
 *
 * Independent of {@link ENGINE_VERSION} (the fiat comparison engine, currently 2.0.0). Bump this
 * when a change would alter routing output for an unchanged input. Do not bump the comparison
 * engine version from here — the two scores are not interchangeable.
 *
 * `2.0.0` adds multi-objective factors (finality, fxRate, slippage, compliance), rail health
 * deprioritization, and structured best-execution attestation. Ranking of an unchanged 1.0.0
 * input is therefore not guaranteed to match.
 */
export const ROUTING_ENGINE_VERSION = '2.0.0';

/** The factors a multi-rail route is scored on. */
export const ROUTING_SCORING_FACTORS = [
  'cost',
  'speed',
  'finality',
  'fxRate',
  'slippage',
  'liquidity',
  'compliance',
] as const;

export type RoutingScoringFactor = (typeof ROUTING_SCORING_FACTORS)[number];

export type RoutingWeights = Readonly<Record<RoutingScoringFactor, Decimal>>;

export interface RoutingWeightsInput {
  readonly cost: DecimalInput;
  readonly speed: DecimalInput;
  readonly finality: DecimalInput;
  readonly fxRate: DecimalInput;
  readonly slippage: DecimalInput;
  readonly liquidity: DecimalInput;
  readonly compliance: DecimalInput;
}

export type SerializedRoutingWeights = Readonly<Record<RoutingScoringFactor, string>>;

export interface ObjectiveWeightBound {
  readonly min: string;
  readonly max: string;
}

export type SerializedObjectiveWeightBounds = Readonly<
  Record<RoutingScoringFactor, ObjectiveWeightBound>
>;

/**
 * Platform policy range for per-request objective weights.
 *
 * Each factor is independently 0..1 inclusive. The set must still sum to exactly 1.
 * Agent or organization policy may tighten these bounds; it cannot loosen them past 0..1.
 */
export const DEFAULT_OBJECTIVE_WEIGHT_BOUNDS: SerializedObjectiveWeightBounds = {
  cost: { min: '0', max: '1' },
  speed: { min: '0', max: '1' },
  finality: { min: '0', max: '1' },
  fxRate: { min: '0', max: '1' },
  slippage: { min: '0', max: '1' },
  liquidity: { min: '0', max: '1' },
  compliance: { min: '0', max: '1' },
};

/**
 * Platform default for the multi-rail router.
 *
 * Cost still leads because it is measured in money. FX quality and speed follow. Finality,
 * slippage, liquidity and compliance break ties and encode settlement / policy quality.
 */
export const DEFAULT_ROUTING_WEIGHTS: SerializedRoutingWeights = {
  cost: '0.3',
  speed: '0.15',
  finality: '0.1',
  fxRate: '0.15',
  slippage: '0.1',
  liquidity: '0.1',
  compliance: '0.1',
};

export type RoutingObjectiveSource = 'request' | 'policy_preference' | 'platform_default';

/**
 * Validates multi-rail scoring weights.
 *
 * They must be non-negative, lie inside the supplied (or platform) bounds, and sum to exactly 1.
 */
export function parseRoutingWeights(
  input: RoutingWeightsInput,
  bounds: SerializedObjectiveWeightBounds = DEFAULT_OBJECTIVE_WEIGHT_BOUNDS,
): RoutingWeights {
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
    const bound = bounds[factor];
    const min = toDecimal(bound.min);
    const max = toDecimal(bound.max);
    if (value.lessThan(min) || value.greaterThan(max)) {
      throw new ValidationError(
        `Routing weight "${factor}" is outside the policy range ${bound.min}–${bound.max}.`,
        {
          weight: factor,
          value: value.toFixed(),
          min: bound.min,
          max: bound.max,
        },
      );
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

export function zeroedRoutingWeights(overrides: Partial<RoutingWeightsInput>): RoutingWeightsInput {
  return {
    cost: '0',
    speed: '0',
    finality: '0',
    fxRate: '0',
    slippage: '0',
    liquidity: '0',
    compliance: '0',
    ...overrides,
  };
}
