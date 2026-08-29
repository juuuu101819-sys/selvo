import {
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  SYNTHETIC_PLACEHOLDER_PROVIDER_ID,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiError, type TestHarness } from '../testing/harness.js';

const OPERATOR = 'unit-test-onboarding-operator-secret-ok';
const OPERATOR_HEADER = { 'x-onboarding-operator-key': OPERATOR };
const PREVIOUS_OPERATOR_SECRET = process.env['ONBOARDING_OPERATOR_SECRET'];

describe('PHASE 38 operator kill switch and credential vault', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    process.env['ONBOARDING_OPERATOR_SECRET'] = OPERATOR;
    harness = await createTestHarness({ ONBOARDING_OPERATOR_SECRET: OPERATOR });
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
    });
  });

  afterAll(async () => {
    await harness.close();
    if (PREVIOUS_OPERATOR_SECRET === undefined) {
      delete process.env['ONBOARDING_OPERATOR_SECRET'];
    } else {
      process.env['ONBOARDING_OPERATOR_SECRET'] = PREVIOUS_OPERATOR_SECRET;
    }
  });

  it('rejects kill-switch mutations without the operator secret', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/routing/overrides`,
      payload: {
        target: { kind: 'provider', providerId: 'sandbox-northgate-bank' },
        reason: 'incident',
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('engages a provider kill switch, excludes it from ranking, shows it on /meta, and audits', async () => {
    const before = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    expect(before.statusCode).toBe(201);
    const beforeIds = before
      .json<{ data: { routes: { provider: { id: string } }[] } }>()
      .data.routes.map((route) => route.provider.id);
    expect(beforeIds).toContain('sandbox-northgate-bank');

    const engaged = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/routing/overrides`,
      headers: OPERATOR_HEADER,
      payload: {
        target: { kind: 'provider', providerId: 'sandbox-northgate-bank' },
        reason: 'incident response: suspected misquote',
      },
    });
    expect(engaged.statusCode).toBe(200);
    expect(engaged.json<{ data: { autoReset: boolean } }>().data.autoReset).toBe(false);

    const after = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    const afterIds = after
      .json<{ data: { routes: { provider: { id: string } }[] } }>()
      .data.routes.map((route) => route.provider.id);
    expect(afterIds).not.toContain('sandbox-northgate-bank');
    expect(afterIds.length).toBeGreaterThan(0);

    harness.clock.advance(60_000);
    const still = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    expect(
      still
        .json<{ data: { routes: { provider: { id: string } }[] } }>()
        .data.routes.map((route) => route.provider.id),
    ).not.toContain('sandbox-northgate-bank');

    const meta = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/meta` });
    const overrides = meta.json<{
      data: {
        manualOverrides: {
          autoReset: boolean;
          active: { providerId: string | null; reason: string; engagedByActor: string }[];
        };
      };
    }>().data.manualOverrides;
    expect(overrides.autoReset).toBe(false);
    expect(overrides.active.some((row) => row.providerId === 'sandbox-northgate-bank')).toBe(true);
    expect(overrides.active[0]?.engagedByActor).toBe('onboarding_operator');

    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'routing.override.engaged')).toBe(true);
    expect(
      events.find((event) => event.type === 'routing.override.engaged')?.payload['reason'],
    ).toBe('incident response: suspected misquote');

    const released = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/routing/overrides/release`,
      headers: OPERATOR_HEADER,
      payload: {
        target: { kind: 'provider', providerId: 'sandbox-northgate-bank' },
        reason: 'incident closed',
      },
    });
    expect(released.statusCode).toBe(200);
    expect(events.concat(await harness.auditEvents()).some((event) => event.type === 'routing.override.released')).toBe(
      true,
    );
  });

  it('requires a free-text reason to engage', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/routing/overrides`,
      headers: OPERATOR_HEADER,
      payload: { target: { kind: 'provider', providerId: 'sandbox-northgate-bank' }, reason: '  ' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('stores a synthetic provider credential encrypted, never on GET, retrievable internally', async () => {
    const plaintext = 'synthetic-placeholder-api-token';
    const stored = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/providers/${SYNTHETIC_PLACEHOLDER_PROVIDER_ID}/credentials`,
      headers: OPERATOR_HEADER,
      payload: { keyName: 'API_TOKEN', secret: plaintext },
    });
    expect(stored.statusCode).toBe(201);
    expect(JSON.stringify(stored.json())).not.toContain(plaintext);

    const leakedGet = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/ops/providers/${SYNTHETIC_PLACEHOLDER_PROVIDER_ID}/credentials`,
      headers: OPERATOR_HEADER,
    });
    expect(leakedGet.statusCode).toBe(404);
    expect(leakedGet.body).not.toContain(plaintext);

    const providers = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/providers/${SYNTHETIC_PLACEHOLDER_PROVIDER_ID}`,
    });
    expect(providers.body).not.toContain(plaintext);

    const ciphertext = await harness.container.persistence.providerCredentials.getCiphertext(
      SYNTHETIC_PLACEHOLDER_PROVIDER_ID,
      'API_TOKEN',
    );
    expect(ciphertext).not.toBeNull();
    expect(ciphertext).not.toContain(plaintext);
    expect(ciphertext?.startsWith('v1$')).toBe(true);

    const internal = await harness.container.providerCredentialVault.getPlaintext(
      SYNTHETIC_PLACEHOLDER_PROVIDER_ID,
      'API_TOKEN',
    );
    expect(internal).toBe(plaintext);

    const meta = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/meta` });
    expect(meta.body).not.toContain(plaintext);

    const events = await harness.auditEvents();
    const storedEvent = events.find((event) => event.type === 'provider.credential.stored');
    expect(storedEvent).toBeDefined();
    expect(JSON.stringify(storedEvent)).not.toContain(plaintext);
    expect(storedEvent?.payload['keyName']).toBe('API_TOKEN');
  });

  it('does not let an org session act as the operator', async () => {
    const login = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
    });
    const token = login.json<{ data: { token: string } }>().data.token;
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/routing/overrides`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        target: { kind: 'provider', providerId: 'sandbox-northgate-bank' },
        reason: 'should not work',
      },
    });
    expect(response.statusCode).toBe(401);
    expect(DEMO_ORGANIZATION_ID).toBe('org_demo_meridian');
  });
});
