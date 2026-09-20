import { describe, expect, it } from 'vitest';
import { DeferredPlatformFeeCollector } from './payment-collector.js';

describe('DeferredPlatformFeeCollector', () => {
  it('reports itself unable to collect', () => {
    const collector = new DeferredPlatformFeeCollector();
    expect(collector.kind).toBe('deferred');
    expect(collector.collectionEnabled).toBe(false);
  });

  it('returns an unconfirmed outcome with a reason rather than claiming success', async () => {
    const outcome = await new DeferredPlatformFeeCollector().collect();
    // An unconfirmed outcome is what the collection service needs to record a failed attempt with
    // a readable reason. Throwing would surface as a 500 and lose the reason.
    expect(outcome.confirmed).toBe(false);
    expect(outcome.processorReference).toBeNull();
    expect(outcome.confirmationSource).toBeNull();
    expect(outcome.failureReason).toMatch(/no payment processor is contracted/i);
  });
});
