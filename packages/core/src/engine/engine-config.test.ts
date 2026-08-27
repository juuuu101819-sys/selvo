import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import {
  DEFAULT_SCORING_WEIGHTS,
  defaultScoringWeights,
  parseScoringWeights,
  serializeScoringWeights,
} from './engine-config.js';

describe('scoring weights', () => {
  it('accepts weights that sum to exactly 1', () => {
    const weights = parseScoringWeights({ cost: '0.5', speed: '0.25', reliability: '0.25' });
    expect(weights.cost.toFixed()).toBe('0.5');
  });

  it('accepts a single dominant weight', () => {
    expect(() => parseScoringWeights({ cost: '1', speed: '0', reliability: '0' })).not.toThrow();
  });

  it('rejects weights that do not sum to 1', () => {
    expect(() => parseScoringWeights({ cost: '0.5', speed: '0.3', reliability: '0.1' })).toThrow(
      ValidationError,
    );
  });

  it('rejects a negative weight even when the set sums to 1', () => {
    expect(() => parseScoringWeights({ cost: '1.5', speed: '-0.5', reliability: '0' })).toThrow(
      ValidationError,
    );
  });

  it('does not admit floating-point drift as a valid sum', () => {
    // 0.1 + 0.2 + 0.7 is exactly 1 in decimal arithmetic, unlike in binary floating point.
    expect(() =>
      parseScoringWeights({ cost: '0.1', speed: '0.2', reliability: '0.7' }),
    ).not.toThrow();
  });

  it('round-trips through serialization', () => {
    expect(serializeScoringWeights(defaultScoringWeights())).toEqual(DEFAULT_SCORING_WEIGHTS);
  });

  it('defaults to cost-weighted scoring across all six factors', () => {
    expect(DEFAULT_SCORING_WEIGHTS).toEqual({
      cost: '0.45',
      speed: '0.25',
      reliability: '0.1',
      slippage: '0.08',
      liquidity: '0.05',
      risk: '0.07',
    });
  });

  it('weights cost above every other factor combined with speed', () => {
    const weights = defaultScoringWeights();
    const soft = weights.reliability
      .plus(weights.slippage)
      .plus(weights.liquidity)
      .plus(weights.risk);

    // The soft factors break ties between close routes; they must not override a cheaper one.
    expect(weights.cost.greaterThan(soft)).toBe(true);
  });

  /**
   * The three factors added in engine 2.0.0 default to zero, so a weight set written against the
   * earlier three-factor engine still sums to 1 and still means what it did.
   */
  it('accepts a three-factor weight set from the earlier engine', () => {
    const weights = parseScoringWeights({ cost: '0.6', speed: '0.3', reliability: '0.1' });

    expect(weights.slippage.isZero()).toBe(true);
    expect(weights.liquidity.isZero()).toBe(true);
    expect(weights.risk.isZero()).toBe(true);
  });

  it('accepts a full six-factor weight set', () => {
    expect(() =>
      parseScoringWeights({
        cost: '0.3',
        speed: '0.2',
        reliability: '0.2',
        slippage: '0.1',
        liquidity: '0.1',
        risk: '0.1',
      }),
    ).not.toThrow();
  });

  it('rejects a six-factor set that does not sum to 1', () => {
    expect(() =>
      parseScoringWeights({
        cost: '0.3',
        speed: '0.2',
        reliability: '0.2',
        slippage: '0.1',
        liquidity: '0.1',
        risk: '0.5',
      }),
    ).toThrow(ValidationError);
  });
});
