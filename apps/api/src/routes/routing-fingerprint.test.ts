import {
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  type FinancialQuoteDto,
  type MultiRailRoutingDto,
  type RoutingReplayResult,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
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
  await provisionDemoTenants({
    identity: harness.container.persistence.identity,
    dashboard: harness.container.persistence.dashboard,
  });
});

afterAll(async () => {
  await harness.close();
});

async function login(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

describe('PA-M10 multi-rail fingerprint and replay', () => {
  it('captures a fingerprint on POST /routes and replays an identical ranking', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    expect(created.statusCode).toBe(201);
    const routing = created.json<ApiEnvelope<MultiRailRoutingDto>>().data;
    expect(routing.fingerprint).toMatch(SHA256_HEX);
    expect(routing.routingEngineVersion).toBe('1.0.0');
    expect(routing).not.toHaveProperty('snapshot');
    expect(routing).not.toHaveProperty('pricingRules');
    expect(routing.monetization?.realizedRevenue).toBe(false);

    const replay = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes/${routing.routingId}/replay`,
    });
    expect(replay.statusCode).toBe(200);
    const first = replay.json<ApiEnvelope<RoutingReplayResult>>().data;
    expect(first.reproducible).toBe(true);
    expect(first.replayedFingerprint).toBe(routing.fingerprint);
    expect(first.rankedRouteIds).toEqual(routing.routes.map((route) => route.routeId));
    expect(first.routing?.routes.map((route) => route.routeId)).toEqual(
      routing.routes.map((route) => route.routeId),
    );
    expect(first.quote).toBeNull();
    expect(first.routing).not.toHaveProperty('snapshot');
    expect(first.routing?.monetization?.realizedRevenue).toBe(false);

    const again = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes/${routing.routingId}/replay`,
    });
    const second = again.json<ApiEnvelope<RoutingReplayResult>>().data;
    expect(second.replayedFingerprint).toBe(first.replayedFingerprint);
    expect(second.rankedRouteIds).toEqual(first.rankedRouteIds);
  });

  it('keeps billed quote replay on the authenticated surface without monetization', async () => {
    const token = await login();
    const quoted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    expect(quoted.statusCode).toBe(201);
    const quote = quoted.json<ApiEnvelope<FinancialQuoteDto>>().data;
    expect(quote.fingerprint).toMatch(SHA256_HEX);
    expect(quote).not.toHaveProperty('monetization');

    const wrongSurface = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes/${quote.routingId}/replay`,
    });
    expect(wrongSurface.statusCode).toBe(404);

    const anonymousQuoteReplay = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote/${quote.routingId}/replay`,
    });
    expect(anonymousQuoteReplay.statusCode).toBe(401);

    const replay = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote/${quote.routingId}/replay`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(replay.statusCode).toBe(200);
    const body = replay.json<ApiEnvelope<RoutingReplayResult>>().data;
    expect(body.reproducible).toBe(true);
    expect(body.surface).toBe('quote');
    expect(body.routing).toBeNull();
    expect(body.quote).not.toBeNull();
    expect(body.quote).not.toHaveProperty('monetization');
    expect(body.quote?.fingerprint).toBe(quote.fingerprint);
  });

  it('returns 404 for an unknown routing evaluation', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes/rte_missing/replay`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<ApiError>().error.code).toBe('NOT_FOUND');
  });
});
