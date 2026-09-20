import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import {
  REVENUE_LIFECYCLE_STATES,
  assertRealizationClaimSupported,
  isSimulatedOrigin,
  resolveRevenueLifecycle,
  revenueOriginEnvForMode,
  type RevenueLifecycleInput,
} from './revenue-lifecycle.js';

/** A record that satisfies every realization precondition. Tests subtract from this. */
const realized: RevenueLifecycleInput = {
  economicStage: 'settled',
  revenueRecognition: 'collected',
  realizedRevenue: true,
  originEnv: 'PRODUCTION',
  settlementFinality: 'provider_confirmed',
  collectionReference: 'proc_ref_1',
};

describe('resolveRevenueLifecycle', () => {
  it('maps the funnel stages onto lifecycle states', () => {
    const base = {
      revenueRecognition: 'unrealized',
      realizedRevenue: false,
      originEnv: 'PRODUCTION',
      settlementFinality: 'unsettled',
      collectionReference: null,
    } as const;
    expect(resolveRevenueLifecycle({ ...base, economicStage: 'route_quote' }).state).toBe(
      'QUOTED_REVENUE',
    );
    expect(resolveRevenueLifecycle({ ...base, economicStage: 'route_selected' }).state).toBe(
      'EXPECTED_REVENUE',
    );
    expect(resolveRevenueLifecycle({ ...base, economicStage: 'execution_intent' }).state).toBe(
      'EXPECTED_REVENUE',
    );
    expect(resolveRevenueLifecycle({ ...base, economicStage: 'settled' }).state).toBe(
      'ATTRIBUTED_REVENUE',
    );
  });

  it('treats an invoiced snapshot as attributed regardless of its stage', () => {
    const resolution = resolveRevenueLifecycle({
      economicStage: 'route_quote',
      revenueRecognition: 'invoiced',
      realizedRevenue: false,
      originEnv: 'PRODUCTION',
      settlementFinality: 'unsettled',
      collectionReference: null,
    });
    expect(resolution.state).toBe('ATTRIBUTED_REVENUE');
    expect(resolution.cashRecognizable).toBe(false);
  });

  it('realizes only when origin, finality, recognition and reference all hold', () => {
    const resolution = resolveRevenueLifecycle(realized);
    expect(resolution.state).toBe('REALIZED_REVENUE');
    expect(resolution.cashRecognizable).toBe(true);
    expect(resolution.capReasons).toEqual([]);
    expect(resolution.cappedFrom).toBeNull();
  });

  it.each([
    ['DEMO', 'non_production_origin'],
    ['SIMULATION', 'non_production_origin'],
    ['PARTNER_SANDBOX', 'non_production_origin'],
  ] as const)('caps a %s origin at attributed even when collected', (originEnv, reason) => {
    const resolution = resolveRevenueLifecycle({ ...realized, originEnv });
    expect(resolution.state).toBe('ATTRIBUTED_REVENUE');
    expect(resolution.cashRecognizable).toBe(false);
    expect(resolution.cappedFrom).toBe('REALIZED_REVENUE');
    expect(resolution.capReasons).toContain(reason);
  });

  it('refuses to realize a simulated settlement finality', () => {
    const resolution = resolveRevenueLifecycle({
      ...realized,
      settlementFinality: 'simulated',
    });
    expect(resolution.state).toBe('ATTRIBUTED_REVENUE');
    expect(resolution.capReasons).toContain('settlement_not_provider_confirmed');
  });

  it('refuses to realize without a collection reference', () => {
    const missing = resolveRevenueLifecycle({ ...realized, collectionReference: null });
    expect(missing.capReasons).toContain('collection_reference_missing');
    expect(missing.state).toBe('ATTRIBUTED_REVENUE');

    const blank = resolveRevenueLifecycle({ ...realized, collectionReference: '   ' });
    expect(blank.capReasons).toContain('collection_reference_missing');
  });

  it('refuses to realize when recognition has not reached collected', () => {
    const resolution = resolveRevenueLifecycle({
      ...realized,
      revenueRecognition: 'invoiced',
    });
    expect(resolution.state).toBe('ATTRIBUTED_REVENUE');
    expect(resolution.capReasons).toContain('recognition_not_collected');
  });

  it('never returns a state outside the closed set', () => {
    const resolution = resolveRevenueLifecycle(realized);
    expect(REVENUE_LIFECYCLE_STATES).toContain(resolution.state);
  });
});

describe('assertRealizationClaimSupported', () => {
  it('accepts a fully supported realization claim', () => {
    expect(() => {
      assertRealizationClaimSupported(realized);
    }).not.toThrow();
  });

  it('accepts any record that does not claim realization', () => {
    expect(() => {
      assertRealizationClaimSupported({
        economicStage: 'settled',
        revenueRecognition: 'unrealized',
        realizedRevenue: false,
        originEnv: 'PARTNER_SANDBOX',
        settlementFinality: 'simulated',
        collectionReference: null,
      });
    }).not.toThrow();
  });

  it('rejects a realization claim from a sandbox origin', () => {
    expect(() => {
      assertRealizationClaimSupported({ ...realized, originEnv: 'PARTNER_SANDBOX' });
    }).toThrow(ValidationError);
  });

  it('rejects a realization claim with only simulated finality', () => {
    expect(() => {
      assertRealizationClaimSupported({ ...realized, settlementFinality: 'simulated' });
    }).toThrow(ValidationError);
  });
});

describe('origin helpers', () => {
  it('derives the origin from the platform mode', () => {
    expect(revenueOriginEnvForMode('production')).toBe('PRODUCTION');
    expect(revenueOriginEnvForMode('sandbox')).toBe('SIMULATION');
  });

  it('classifies every non-production origin as simulated', () => {
    expect(isSimulatedOrigin('PRODUCTION')).toBe(false);
    expect(isSimulatedOrigin('DEMO')).toBe(true);
    expect(isSimulatedOrigin('SIMULATION')).toBe(true);
    expect(isSimulatedOrigin('PARTNER_SANDBOX')).toBe(true);
  });
});
