import { ValidationError } from '../errors/index.js';
import { Dec, type Decimal, type DecimalInput, toDecimal } from '../money/index.js';

/**
 * Version of the routing engine's calculation semantics.
 *
 * Bump this whenever a change would alter the output for an unchanged input. It is part of every
 * comparison fingerprint, so a stored comparison always records which semantics produced it, and a
 * replay across an engine change is detectable rather than silently different.
 *
 * `2.0.0` added platform pricing to the cost model and three factors to the score, both of which
 * change the output for identical inputs.
 */
export const ENGINE_VERSION = '2.0.0';

/** The factors a route is scored on. */
export const SCORING_FACTORS = [
  'cost',
  'speed',
  'reliability',
  'slippage',
  'liquidity',
  'risk',
] as const;

export type ScoringFactor = (typeof SCORING_FACTORS)[number];

export type ScoringWeights = Readonly<Record<ScoringFactor, Decimal>>;

/**
 * Weights as supplied by a caller.
 *
 * The three factors added in engine 2.0.0 are optional and default to zero, so a weight set written
 * against the earlier three-factor engine still sums to 1 and still means what it did.
 */
export interface ScoringWeightsInput {
  readonly cost: DecimalInput;
  readonly speed: DecimalInput;
  readonly reliability: DecimalInput;
  readonly slippage?: DecimalInput | undefined;
  readonly liquidity?: DecimalInput | undefined;
  readonly risk?: DecimalInput | undefined;
}

export type SerializedScoringWeights = Readonly<Record<ScoringFactor, string>>;

/**
 * Platform default.
 *
 * Cost dominates because it is what a treasury team is optimising and the only factor measured in
 * money. Speed is next because a settlement delay has a real financing cost. The remaining factors
 * are deliberately small: they break ties between routes that are close on cost and speed, which is
 * where they belong, rather than overriding a materially cheaper route on a soft signal.
 */
export const DEFAULT_SCORING_WEIGHTS: SerializedScoringWeights = {
  cost: '0.45',
  speed: '0.25',
  reliability: '0.1',
  slippage: '0.08',
  liquidity: '0.05',
  risk: '0.07',
};

/**
 * Validates scoring weights.
 *
 * They must be non-negative and sum to exactly 1, which keeps scores comparable across requests: a
 * weight set summing to 0.9 would silently compress every score, and one summing to 1.1 would let a
 * route exceed 100.
 */
export function parseScoringWeights(input: ScoringWeightsInput): ScoringWeights {
  const weights = Object.fromEntries(
    SCORING_FACTORS.map((factor) => [factor, toDecimal(input[factor] ?? '0')]),
  ) as ScoringWeights;

  for (const factor of SCORING_FACTORS) {
    const value = weights[factor];
    if (value.isNegative() || !value.isFinite()) {
      throw new ValidationError(`Scoring weight "${factor}" must be a non-negative decimal.`, {
        weight: factor,
        value: value.toFixed(),
      });
    }
  }

  const total = SCORING_FACTORS.reduce((sum, factor) => sum.plus(weights[factor]), new Dec(0));
  if (!total.equals(new Dec(1))) {
    throw new ValidationError('Scoring weights must sum to exactly 1.', {
      ...serializeScoringWeights(weights),
      sum: total.toFixed(),
    });
  }

  return weights;
}

export function serializeScoringWeights(weights: ScoringWeights): SerializedScoringWeights {
  return Object.fromEntries(
    SCORING_FACTORS.map((factor) => [factor, weights[factor].toFixed()]),
  ) as SerializedScoringWeights;
}

export const defaultScoringWeights = (): ScoringWeights =>
  parseScoringWeights(DEFAULT_SCORING_WEIGHTS);

/**
 * Depth at which a route is considered unconstrained, as a multiple of the requested notional.
 *
 * Two times cover is full marks. A provider that can just barely fill the order is a real execution
 * risk even though it technically can, so the score should not treat one-times cover as ideal.
 */
export const LIQUIDITY_COMFORT_MULTIPLE = new Dec(2);

/** Risk score used when a provider supplies no risk signals. Neutral, neither rewarded nor punished. */
export const NEUTRAL_RISK_SCORE = new Dec('0.75');
