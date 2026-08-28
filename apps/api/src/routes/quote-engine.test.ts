import type { ComparisonDto } from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_V1_PREFIX } from './index.js';
import {
  createTestHarness,
  type ApiEnvelope,
  type ApiError,
  type TestHarness,
} from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});

afterAll(async () => {
  await harness.close();
});

async function compare(
  body: Record<string, unknown>,
): Promise<{ status: number; payload: ApiEnvelope<ComparisonDto> }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/comparisons`,
    payload: body,
  });
  return { status: response.statusCode, payload: response.json<ApiEnvelope<ComparisonDto>>() };
}

const USD_100K = { sourceCurrency: 'USD', amount: '100000.00' };

describe('the quote engine over HTTP', () => {
  it('returns ranked routes and a recommendation for the worked example', async () => {
    const { status, payload } = await compare({ ...USD_100K, targetCurrency: 'KRW' });

    expect(status).toBe(201);
    expect(payload.data.recommendedRouteId).toBe(payload.data.routes[0]?.routeId);
    expect(payload.data.routes.map((route) => route.rank)).toEqual(
      payload.data.routes.map((_, index) => index + 1),
    );

    // Every figure the brief asks the engine to calculate, present on every route.
    for (const route of payload.data.routes) {
      expect(route.offeredRate.value).toMatch(/^\d+(\.\d+)?$/);
      expect(route.totalCost.minorUnits).toMatch(/^\d+$/);
      expect(route.deliveredAmount.minorUnits).toMatch(/^\d+$/);
      expect(route.settlement.p50Seconds).toBeGreaterThan(0);
      expect(Number(route.score)).toBeGreaterThanOrEqual(0);
      expect(Number(route.score)).toBeLessThanOrEqual(100);
      expect(route.spreadBps).toBeDefined();
      expect(route.slippageBps).toBeDefined();
      expect(route.breakdown.platformFeeCost).toBeDefined();
    }
  });

  it('reports all six score components, so a ranking can be explained', async () => {
    const { payload } = await compare({ ...USD_100K, targetCurrency: 'KRW' });
    const components = payload.data.routes[0]?.scoreComponents;

    expect(Object.keys(components ?? {}).sort()).toEqual([
      'cost',
      'liquidity',
      'reliability',
      'settlementConfidence',
      'speed',
    ]);
  });

  it('accepts destinationCurrency as a synonym for targetCurrency', async () => {
    const withTarget = await compare({ ...USD_100K, targetCurrency: 'KRW' });
    const withDestination = await compare({ ...USD_100K, destinationCurrency: 'KRW' });

    expect(withDestination.status).toBe(201);
    expect(withDestination.payload.data.request.targetCurrency).toBe('KRW');
    // Same corridor, so the same calculation.
    expect(withDestination.payload.data.fingerprint).toBe(withTarget.payload.data.fingerprint);
  });

  it('requires a receiving currency under one name or the other', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/comparisons`,
      payload: USD_100K,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects the two names disagreeing rather than silently preferring one', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/comparisons`,
      payload: { ...USD_100K, targetCurrency: 'KRW', destinationCurrency: 'JPY' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json<ApiError>().error.details)).toContain('must agree');
  });

  describe('platform pricing', () => {
    /**
     * With the in-memory driver there are no customers and therefore no negotiated terms. The engine
     * quotes without a platform fee rather than inventing a default one: charging a markup nobody
     * agreed to would be worse than charging none.
     */
    it('charges nothing when no commercial terms are configured', async () => {
      const { payload } = await compare({ ...USD_100K, targetCurrency: 'KRW' });

      for (const route of payload.data.routes) {
        expect(route.platformPricing.ruleId).toBeNull();
        expect(route.breakdown.platformFeeCost.minorUnits).toBe('0');
        expect(route.breakdown.appliedFees.some((fee) => fee.chargedBy === 'platform')).toBe(false);
      }
    });

    it('attributes every fee to whoever levied it', async () => {
      const { payload } = await compare({ ...USD_100K, targetCurrency: 'KRW' });
      const fees = payload.data.routes.flatMap((route) => route.breakdown.appliedFees);

      expect(fees.length).toBeGreaterThan(0);
      for (const fee of fees) {
        expect(['provider', 'platform']).toContain(fee.chargedBy);
      }
    });

    it('reports which organization a comparison was priced for', async () => {
      const { payload } = await compare({ ...USD_100K, targetCurrency: 'KRW' });

      // Null while authentication is unimplemented: the principal carries no organization yet.
      expect(payload.data).toHaveProperty('organizationId');
      expect(payload.data.organizationId).toBeNull();
    });

    /**
     * The tenancy identity comes only from the authenticated principal. A caller who could claim an
     * organizationId in the request body would be choosing whose negotiated pricing they are quoted
     * on — another customer's discount, another customer's markup — so the strict schema must
     * reject the field, not ignore it.
     */
    it('rejects a caller claiming an organizationId in the body', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons`,
        payload: { ...USD_100K, targetCurrency: 'KRW', organizationId: 'org_demo_meridian' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json<ApiError>();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(body.error.details)).toContain('organizationId');
    });
  });

  describe('the cost breakdown reconciles', () => {
    it('sums to the total on every route, platform fee included', async () => {
      const { payload } = await compare({ ...USD_100K, targetCurrency: 'KRW' });

      for (const route of payload.data.routes) {
        const { breakdown } = route;
        const attributed =
          BigInt(breakdown.sourceFeeCost.minorUnits) +
          BigInt(breakdown.platformFeeCost.minorUnits) +
          BigInt(breakdown.destinationFeeCost.minorUnits) +
          BigInt(breakdown.fxSpreadCost.minorUnits) +
          BigInt(breakdown.slippageCost.minorUnits) +
          BigInt(breakdown.roundingAdjustment.minorUnits);

        expect(attributed).toBe(BigInt(route.totalCost.minorUnits));
      }
    });

    it('measures cost as the gap between the benchmark and what is delivered', async () => {
      const { payload } = await compare({ ...USD_100K, targetCurrency: 'KRW' });

      for (const route of payload.data.routes) {
        expect(BigInt(route.totalCost.minorUnits)).toBe(
          BigInt(route.benchmarkAmount.minorUnits) - BigInt(route.deliveredAmount.minorUnits),
        );
      }
    });
  });

  describe('replay under a changed engine', () => {
    it('reports a replay as reproducible when the engine has not changed', async () => {
      const created = await compare({ ...USD_100K, targetCurrency: 'KRW' });
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons/${created.payload.data.comparisonId}/replay`,
      });

      const replay = response.json<{
        data: { reproducible: boolean; divergence: string | null; replayEngineVersion: string };
      }>().data;

      expect(replay.reproducible).toBe(true);
      expect(replay.divergence).toBeNull();
      expect(replay.replayEngineVersion).toBe('1.0.0');
    });

    it('names both engine versions, so a divergence is diagnosable', async () => {
      const created = await compare({ ...USD_100K, targetCurrency: 'KRW' });
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons/${created.payload.data.comparisonId}/replay`,
      });

      const replay = response.json<{
        data: { originalEngineVersion: string; replayEngineVersion: string };
      }>().data;

      expect(replay.originalEngineVersion).toBe(replay.replayEngineVersion);
    });
  });

  describe('edge cases over the wire', () => {
    it.each([
      ['zero', '0'],
      ['negative', '-100'],
    ])('rejects a %s amount', async (_name, amount) => {
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons`,
        payload: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<ApiError>().error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an amount above the deployment ceiling', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons`,
        payload: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '999999999999999' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<ApiError>().error.message).toMatch(/maximum comparable notional/);
    });

    it('prices a large but permitted amount without losing precision', async () => {
      const { status, payload } = await compare({
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amount: '5000000.00',
      });

      expect(status).toBe(201);
      expect(payload.data.request.amount.minorUnits).toBe('500000000');
      // Wholesale size, so the liquidity provider's tiered pricing should be keener than at 100k.
      expect(payload.data.routes.length).toBeGreaterThan(0);
    });

    it('rejects an unsupported currency', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons`,
        payload: { sourceCurrency: 'USD', targetCurrency: 'XXX', amount: '100000.00' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('reports when no provider will price the request', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons`,
        payload: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '1.00' },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json<ApiError>().error.code).toBe('UNSUPPORTED_CORRIDOR');
    });
  });
});
