import { describe, expect, it } from 'vitest';
import { costDistribution, settlementTimeDistribution, slippageDistribution } from './routing-simulation.js';

describe('routing simulation distributions', () => {
  it('is a closed-form function of p50 and p95 with no randomness', () => {
    const first = settlementTimeDistribution(300, 900);
    const second = settlementTimeDistribution(300, 900);
    expect(second).toEqual(first);
    expect(first.model).toBe('log_normal_from_p50_p95');
    expect(Number(first.p50)).toBe(300);
    expect(Number(first.p95)).toBe(900);
    expect(Number(first.p10)).toBeLessThan(Number(first.p50));
    expect(Number(first.p99)).toBeGreaterThan(Number(first.p95));
  });

  it('collapses to a point mass when p50 equals p95', () => {
    expect(settlementTimeDistribution(60, 60).model).toBe('point');
    expect(costDistribution('12.5', '0').model).toBe('point');
    expect(slippageDistribution('0').p50).toBe('0');
  });
});
