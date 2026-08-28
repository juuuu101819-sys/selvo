import { describe, expect, it } from 'vitest';
import { DeferredPlatformFeeCollector } from './payment-collector.js';

describe('DeferredPlatformFeeCollector', () => {
  it('refuses to collect and never exposes a paid path', () => {
    const collector = new DeferredPlatformFeeCollector();
    expect(collector.kind).toBe('deferred');
    expect(collector.collectionEnabled).toBe(false);
    expect(() => collector.collect()).toThrow(/deferred/i);
  });
});
