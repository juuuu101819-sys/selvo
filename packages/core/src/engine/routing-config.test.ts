import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import {
  DEFAULT_ROUTING_WEIGHTS,
  parseRoutingWeights,
  serializeRoutingWeights,
  zeroedRoutingWeights,
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
        finality: '0.5',
        fxRate: '0',
        slippage: '0',
        liquidity: '0',
        compliance: '0',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a weight outside the policy range', () => {
    expect(() =>
      parseRoutingWeights(zeroedRoutingWeights({ cost: '1.1' })),
    ).toThrow(ValidationError);
  });

  it('rejects a negative weight', () => {
    expect(() =>
      parseRoutingWeights({
        cost: '-0.45',
        speed: '0.65',
        finality: '0.2',
        fxRate: '0.2',
        slippage: '0.2',
        liquidity: '0.1',
        compliance: '0.1',
      }),
    ).toThrow(ValidationError);
  });
});
