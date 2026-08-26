import { ValidationError } from '../errors/index.js';
import { Dec, type Decimal, type DecimalInput, toDecimal } from '../money/index.js';

/**
 * Version of the routing engine's calculation semantics.
 *
 * Bump this whenever a change would alter the output for an unchanged input. It is part of every
 * comparison fingerprint, so a stored comparison always records which semantics produced it and
 * a replay across an engine change is detectable rather than silently different.
 */
export const ENGINE_VERSION = '1.0.0';

export interface ScoringWeights {
  readonly cost: Decimal;
  readonly speed: Decimal;
  readonly reliability: Decimal;
}

export interface ScoringWeightsInput {
  readonly cost: DecimalInput;
  readonly speed: DecimalInput;
  readonly reliability: DecimalInput;
}

export interface SerializedScoringWeights {
  readonly cost: string;
  readonly speed: string;
  readonly reliability: string;
}

export const DEFAULT_SCORING_WEIGHTS: SerializedScoringWeights = {
  cost: '0.6',
  speed: '0.3',
  reliability: '0.1',
};

/**
 * Validates scoring weights. They must be non-negative and sum to exactly 1, which keeps scores
 * comparable across requests: a weight set that summed to 0.9 would silently compress every score.
 */
export function parseScoringWeights(input: ScoringWeightsInput): ScoringWeights {
  const weights = {
    cost: toDecimal(input.cost),
    speed: toDecimal(input.speed),
    reliability: toDecimal(input.reliability),
  } satisfies ScoringWeights;

  for (const [name, value] of Object.entries(weights)) {
    if (value.isNegative() || !value.isFinite()) {
      throw new ValidationError(`Scoring weight "${name}" must be a non-negative decimal.`, {
        weight: name,
        value: value.toFixed(),
      });
    }
  }

  const total = weights.cost.plus(weights.speed).plus(weights.reliability);
  if (!total.equals(new Dec(1))) {
    throw new ValidationError('Scoring weights must sum to exactly 1.', {
      cost: weights.cost.toFixed(),
      speed: weights.speed.toFixed(),
      reliability: weights.reliability.toFixed(),
      sum: total.toFixed(),
    });
  }

  return weights;
}

export function serializeScoringWeights(weights: ScoringWeights): SerializedScoringWeights {
  return {
    cost: weights.cost.toFixed(),
    speed: weights.speed.toFixed(),
    reliability: weights.reliability.toFixed(),
  };
}

export const defaultScoringWeights = (): ScoringWeights =>
  parseScoringWeights(DEFAULT_SCORING_WEIGHTS);
