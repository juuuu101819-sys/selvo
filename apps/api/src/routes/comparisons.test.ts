import type { ComparisonDto, ReplayResultDto } from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const USD_100K_TO_KRW = {
  sourceCurrency: 'USD',
  targetCurrency: 'KRW',
  amount: '100000.00',
};

async function createComparison(
  body: Record<string, unknown> = USD_100K_TO_KRW,
  headers: Record<string, string> = {},
): Promise<{ status: number; payload: ApiEnvelope<ComparisonDto> }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/comparisons',
    headers: { 'content-type': 'application/json', ...headers },
    payload: JSON.stringify(body),
  });
  return { status: response.statusCode, payload: response.json<ApiEnvelope<ComparisonDto>>() };
}

describe('POST /v1/comparisons', () => {
  describe('the worked example from the product brief', () => {
    it('returns ranked routes with a recommendation for USD 100,000 to KRW', async () => {
      const { status, payload } = await createComparison();

      expect(status).toBe(201);
      expect(payload.data.routes.length).toBeGreaterThanOrEqual(3);
      expect(payload.data.routes.map((route) => route.rank)).toEqual(
        payload.data.routes.map((_, index) => index + 1),
      );
      expect(payload.data.recommendedRouteId).toBe(payload.data.routes[0]?.routeId);
      expect(payload.data.routes[0]?.recommended).toBe(true);
    });

    it('reports the all-in cost of each rail as a decimal percent', async () => {
      const { payload } = await createComparison();
      expect(payload.data.engineVersion).toBe('1.0.0');
      for (const route of payload.data.routes) {
        expect(route.totalCostPercent).toMatch(/^\d+(\.\d+)?$/);
      }
      const rails = new Set(payload.data.routes.map((route) => route.provider.rail));
      expect(rails.has('bank_fx')).toBe(true);
      expect(rails.has('stablecoin_settlement')).toBe(true);
    });

    it('recommends the stablecoin route, which is cheapest and fastest here', async () => {
      const { payload } = await createComparison();
      const recommended = payload.data.routes[0];

      expect(recommended?.provider.rail).toBe('stablecoin_settlement');
      expect(recommended?.settlement.p50Seconds).toBe(300);
      expect(recommended?.quote.intermediaryAsset).toBe('USDC');
    });

    it('quantifies the saving against the bank baseline', async () => {
      const { payload } = await createComparison();
      const insights = payload.data.insights;

      expect(insights?.savingsVsBankFx?.currency).toBe('KRW');
      expect(BigInt(insights?.savingsVsBankFx?.minorUnits ?? '0')).toBeGreaterThan(0n);
      expect(insights?.cheapestRouteId).toBe(payload.data.recommendedRouteId);
    });
  });

  describe('response contract', () => {
    it('states the platform mode and a non-binding disclaimer on every response', async () => {
      const { payload } = await createComparison();

      expect(payload.meta.mode).toBe('sandbox');
      expect(payload.meta.disclaimer).toMatch(/not executable/);
      expect(payload.meta.requestId).toMatch(/^req_[0-9a-f]{32}$/);
    });

    it('returns monetary amounts as integer minor units plus a display decimal', async () => {
      const { payload } = await createComparison();
      const route = payload.data.routes[0];

      expect(route?.deliveredAmount).toMatchObject({ currency: 'KRW', exponent: 0 });
      expect(route?.deliveredAmount.minorUnits).toMatch(/^\d+$/);
      expect(route?.sendAmount).toMatchObject({
        currency: 'USD',
        minorUnits: '10000000',
        decimal: '100000.00',
      });
    });

    it('exposes a full cost breakdown that reconciles to the total', async () => {
      const { payload } = await createComparison();

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

    it('timestamps and attributes every quote', async () => {
      const { payload } = await createComparison();

      for (const route of payload.data.routes) {
        expect(route.quote.providerId).toBe(route.provider.id);
        expect(route.quote.quotedAt).toBe('2026-03-01T09:00:00.000Z');
        expect(route.quote.expiresAt).not.toBeNull();
        expect(route.quote.freshness).not.toBeNull();
        expect(route.quote.freshness?.ageMs).toBe(0);
        expect(route.quote.freshness?.ageSeconds).toBe('0');
        expect(route.quote.freshness?.state).toBe('fresh');
        expect(route.quote.pricingVersion).toBe('sandbox-pricing-2026.02');
      }
    });

    it('reports the scoring weights that produced the ranking', async () => {
      const { payload } = await createComparison();
      expect(payload.data.scoringWeights).toEqual({
        cost: '0.45',
        speed: '0.2',
        liquidity: '0.15',
        reliability: '0.1',
        settlementConfidence: '0.1',
      });
    });

    it('sets a request id header', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/comparisons',
        payload: USD_100K_TO_KRW,
      });
      expect(response.headers['x-request-id']).toMatch(/^req_/);
    });
  });

  describe('filters and options', () => {
    it('restricts the comparison to the requested rails', async () => {
      const { payload } = await createComparison({
        ...USD_100K_TO_KRW,
        rails: ['bank_fx', 'payment_institution'],
      });

      expect(payload.data.routes.map((route) => route.provider.rail).sort()).toEqual([
        'bank_fx',
        'payment_institution',
      ]);
      expect(payload.data.request.rails).toEqual(['bank_fx', 'payment_institution']);
    });

    it('restricts the comparison to currently priced rails in a family', async () => {
      const { status, payload } = await createComparison({
        ...USD_100K_TO_KRW,
        railFamilies: ['tradfi'],
      });

      expect(status).toBe(201);
      expect(payload.data.routes.length).toBeGreaterThan(0);
      expect(
        payload.data.routes.every((route) =>
          ['bank_fx', 'payment_institution', 'liquidity_provider'].includes(route.provider.rail),
        ),
      ).toBe(true);
      expect(payload.data.routes.map((route) => route.provider.rail)).not.toContain(
        'stablecoin_settlement',
      );
    });

    it('intersects an explicit rail list with a family filter', async () => {
      const { payload } = await createComparison({
        ...USD_100K_TO_KRW,
        rails: ['bank_fx', 'stablecoin_settlement'],
        railFamilies: ['tradfi'],
      });

      expect(payload.data.routes.map((route) => route.provider.rail)).toEqual(['bank_fx']);
    });

    it('rejects a DeFi-only family filter because that family has no priced rails', async () => {
      const { status, payload } = await createComparison({
        ...USD_100K_TO_KRW,
        railFamilies: ['defi'],
      });

      expect(status).toBe(400);
      expect((payload as unknown as ApiError).error.code).toBe('VALIDATION_ERROR');
    });

    it('applies caller-supplied scoring weights', async () => {
      const { payload } = await createComparison({
        ...USD_100K_TO_KRW,
        weights: { cost: '0', speed: '0', reliability: '1' },
      });

      expect(payload.data.routes[0]?.provider.rail).toBe('bank_fx');
      expect(payload.data.scoringWeights).toEqual({
        cost: '0',
        speed: '0',
        reliability: '1',
        liquidity: '0',
        settlementConfidence: '0',
      });
    });

    it('reports providers that could not serve the request', async () => {
      // Aperture Liquidity is wholesale only, from USD 25,000, so it drops out below that.
      const { payload } = await createComparison({ ...USD_100K_TO_KRW, amount: '5000.00' });

      expect(payload.data.routes.map((route) => route.provider.rail)).not.toContain(
        'liquidity_provider',
      );
      expect(payload.data.routes.length).toBeGreaterThan(0);
    });
  });

  describe('input validation', () => {
    const cases: readonly { name: string; body: unknown; code: string }[] = [
      {
        name: 'an unsupported source currency',
        body: { ...USD_100K_TO_KRW, sourceCurrency: 'XXX' },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'a missing amount',
        body: { sourceCurrency: 'USD', targetCurrency: 'KRW' },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'a negative amount',
        body: { ...USD_100K_TO_KRW, amount: '-100' },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'a zero amount',
        body: { ...USD_100K_TO_KRW, amount: '0' },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'an amount that is not a number',
        body: { ...USD_100K_TO_KRW, amount: 'one hundred' },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'a numeric amount instead of a decimal string',
        body: { ...USD_100K_TO_KRW, amount: 100000 },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'the same currency on both sides',
        body: { ...USD_100K_TO_KRW, targetCurrency: 'USD' },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'an unknown rail',
        body: { ...USD_100K_TO_KRW, rails: ['carrier_pigeon'] },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'an empty rail filter',
        body: { ...USD_100K_TO_KRW, rails: [] },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'an unknown rail family',
        body: { ...USD_100K_TO_KRW, railFamilies: ['hawala'] },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'weights that do not sum to one',
        body: { ...USD_100K_TO_KRW, weights: { cost: '1', speed: '1', reliability: '1' } },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'an unknown field, which could smuggle in personal data',
        body: { ...USD_100K_TO_KRW, beneficiaryName: 'Jane Doe' },
        code: 'VALIDATION_ERROR',
      },
      {
        name: 'an amount more precise than the currency allows',
        body: { ...USD_100K_TO_KRW, amount: '100000.005' },
        code: 'VALIDATION_ERROR',
      },
    ];

    it.each(cases)('rejects $name', async ({ body, code }) => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/comparisons',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(body),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<ApiError>().error.code).toBe(code);
      expect(response.json<ApiError>().error.requestId).toMatch(/^req_/);
    });

    it('rejects a KRW amount with decimal places, since the won has none', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/comparisons',
        payload: { sourceCurrency: 'KRW', targetCurrency: 'USD', amount: '1000.50' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<ApiError>().error.message).toContain('0 decimal places');
    });

    it('accepts a KRW amount with no decimal places', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/comparisons',
        payload: { sourceCurrency: 'KRW', targetCurrency: 'USD', amount: '138000000' },
      });

      expect(response.statusCode).toBe(201);
    });

    it('rejects malformed JSON with a structured error', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/comparisons',
        headers: { 'content-type': 'application/json' },
        payload: '{"sourceCurrency":',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<ApiError>().error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an amount above the deployment maximum', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/comparisons',
        payload: { ...USD_100K_TO_KRW, amount: '999999999999999' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<ApiError>().error.message).toMatch(/maximum comparable notional/);
    });
  });

  describe('corridors nobody prices', () => {
    it('reports an unsupported corridor rather than an empty result', async () => {
      // The stablecoin partner has no Chilean peso on-ramp, and the filter excludes every rail
      // that would otherwise cover the corridor.
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/comparisons',
        payload: {
          sourceCurrency: 'CLP',
          targetCurrency: 'USD',
          amount: '95000000',
          rails: ['stablecoin_settlement'],
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json<ApiError>().error.code).toBe('UNSUPPORTED_CORRIDOR');
    });

    it('does not blame the corridor when the amount is below every provider minimum', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/comparisons',
        payload: { ...USD_100K_TO_KRW, amount: '1.00' },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json<ApiError>();
      expect(body.error.code).toBe('UNSUPPORTED_CORRIDOR');
      expect(body.error.message).toContain('1.00 USD');
      expect(body.error.message).toMatch(/outside every provider/);
      expect(body.error.details).toMatchObject({ sourceCurrency: 'USD', targetCurrency: 'KRW' });
    });

    it('points at the rail filter when that is what excluded every provider', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/comparisons',
        payload: {
          sourceCurrency: 'CLP',
          targetCurrency: 'USD',
          amount: '95000000',
          rails: ['stablecoin_settlement'],
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json<ApiError>().error.message).toMatch(/removing the rail filter/);
    });

    it('still prices a corridor the wholesale rails decline, using the rails that cover it', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/comparisons',
        payload: { sourceCurrency: 'KWD', targetCurrency: 'CLP', amount: '1000.000' },
      });

      expect(response.statusCode).toBe(201);
      const rails = response
        .json<ApiEnvelope<ComparisonDto>>()
        .data.routes.map((route) => route.provider.rail);
      expect(rails).toContain('bank_fx');
      expect(rails).not.toContain('stablecoin_settlement');
    });
  });

  describe('idempotency', () => {
    it('returns the same comparison for a repeated idempotency key', async () => {
      const key = `test-key-${Date.now()}`;
      const first = await createComparison(USD_100K_TO_KRW, { 'idempotency-key': key });
      const second = await createComparison(USD_100K_TO_KRW, { 'idempotency-key': key });

      expect(second.payload.data.comparisonId).toBe(first.payload.data.comparisonId);
      expect(second.payload.data.fingerprint).toBe(first.payload.data.fingerprint);
    });

    it('rejects an idempotency key that is too short to be meaningful', async () => {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/comparisons',
        headers: { 'idempotency-key': 'short' },
        payload: USD_100K_TO_KRW,
      });

      expect(response.statusCode).toBe(400);
    });
  });
});

describe('GET /v1/comparisons/:comparisonId', () => {
  it('returns the comparison exactly as it was quoted', async () => {
    const created = await createComparison();
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/comparisons/${created.payload.data.comparisonId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ApiEnvelope<ComparisonDto>>().data).toEqual(created.payload.data);
  });

  it('returns 404 for an unknown comparison', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/comparisons/cmp_nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ApiError>().error.code).toBe('NOT_FOUND');
  });
});

describe('GET /v1/comparisons', () => {
  it('lists recent comparisons newest first', async () => {
    harness.clock.advance(60_000);
    const created = await createComparison();
    const response = await harness.app.inject({ method: 'GET', url: '/v1/comparisons?limit=5' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { comparisonId: string }[]; meta: { limit: number } }>();
    expect(body.data[0]?.comparisonId).toBe(created.payload.data.comparisonId);
    expect(body.meta.limit).toBe(5);
    expect(body.meta).toHaveProperty('nextCursor');
  });

  it('rejects a limit outside the allowed range', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/comparisons?limit=5000' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown query parameter', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/v1/comparisons?offset=10' });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /v1/comparisons/:comparisonId/replay', () => {
  it('reproduces a stored comparison bit for bit', async () => {
    const created = await createComparison();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/comparisons/${created.payload.data.comparisonId}/replay`,
    });

    expect(response.statusCode).toBe(200);
    const replay = response.json<ApiEnvelope<ReplayResultDto>>().data;

    expect(replay.reproducible).toBe(true);
    expect(replay.replayedFingerprint).toBe(created.payload.data.fingerprint);
    expect(replay.originalFingerprint).toBe(replay.replayedFingerprint);
    expect(replay.comparison.routes.map((route) => route.totalCost.minorUnits)).toEqual(
      created.payload.data.routes.map((route) => route.totalCost.minorUnits),
    );
  });

  it('accepts a bodyless replay that still declares a JSON content type', async () => {
    // Most HTTP clients set this header on any POST. Fastify's default parser rejects an empty
    // body outright, which made this endpoint unusable from a normal client.
    const created = await createComparison();
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/comparisons/${created.payload.data.comparisonId}/replay`,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ApiEnvelope<ReplayResultDto>>().data.reproducible).toBe(true);
  });

  it('returns 404 when replaying an unknown comparison', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/v1/comparisons/cmp_nope/replay',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /v1/comparisons/:comparisonId/audit', () => {
  it('returns the audit trail for the comparison', async () => {
    const created = await createComparison(USD_100K_TO_KRW, { 'x-meridian-actor': 'treasury-ops' });
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/comparisons/${created.payload.data.comparisonId}/audit`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: { events: { type: string; actor: string }[] };
    }>();
    const types = body.data.events.map((event) => event.type);

    expect(types).toContain('comparison.requested');
    expect(types).toContain('comparison.completed');
    expect(body.data.events.every((event) => event.actor === 'anonymous')).toBe(true);
  });

  it('shows which provider quoted what for the comparison', async () => {
    const created = await createComparison();
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/comparisons/${created.payload.data.comparisonId}/audit`,
    });

    const events = response.json<{
      data: { events: { type: string; providerId: string | null }[] };
    }>().data.events;
    const quoteEvents = events.filter((event) => event.type === 'provider.quote.received');

    expect(quoteEvents).toHaveLength(4);
    expect(quoteEvents.map((event) => event.providerId).sort()).toEqual([
      'sandbox-meridian-liquidity',
      'sandbox-northgate-bank',
      'sandbox-solstice-settlement',
      'sandbox-veridian-payments',
    ]);
  });

  it('records a replay in the audit trail', async () => {
    const created = await createComparison();
    await harness.app.inject({
      method: 'POST',
      url: `/v1/comparisons/${created.payload.data.comparisonId}/replay`,
    });

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/comparisons/${created.payload.data.comparisonId}/audit`,
    });
    const types = response
      .json<{ data: { events: { type: string }[] } }>()
      .data.events.map((event) => event.type);

    expect(types).toContain('comparison.replayed');
  });

  it('returns 404 for an unknown comparison', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/comparisons/cmp_nope/audit',
    });
    expect(response.statusCode).toBe(404);
  });
});
