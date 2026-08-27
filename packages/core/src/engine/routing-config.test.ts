import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import {
  DEFAULT_ROUTING_WEIGHTS,
  parseRoutingWeights,
  serializeRoutingWeights,
} from './routing-config.js';

describe('parseRoutingWeights', () => {
  it('accepts the platform default set', () => {
    const weights = parseRoutingWeights(DEFAULT_ROUTING_WEIGHTS);
    expect(serializeRoutingWeights(weights)).toEqual(DEFAULT_ROUTING_WEIGHTS);
  });

  it('rejects a set that does not sum to 1', () => {
    expect(() =>
      parseRoutingWeights({
        cost: '0.5',
        speed: '0.5',
        liquidity: '0.5',
        reliability: '0',
        settlementConfidence: '0',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a negative weight', () => {
    expect(() =>
      parseRoutingWeights({
        cost: '-0.45',
        speed: '0.65',
        liquidity: '0.2',
        reliability: '0.3',
        settlementConfidence: '0.3',
      }),
    ).toThrow(ValidationError);
  });
});
