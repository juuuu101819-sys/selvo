import {
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_USER_EMAIL,
  OTHER_USER_PASSWORD,
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

interface PartnerCatalog {
  readonly partners: readonly {
    readonly partnerId: string;
    readonly kind: string;
    readonly live: boolean;
    readonly sandbox: boolean;
  }[];
  readonly partnerLiveEnabled: boolean;
  readonly livePartnersRegistered: boolean;
}

interface Instruction {
  readonly id: string;
  readonly partnerId: string;
  readonly status: string;
  readonly filledMinorUnits: string;
  readonly instructionHash: string;
  readonly fundsMoved: boolean;
  readonly meridianKeysUsed: boolean;
  readonly sandbox: boolean;
  readonly failoverFrom: readonly string[];
}

async function login(harness: TestHarness, email: string, password: string): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email, password },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { token: string } }>().data.token;
}

function signedBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    quoteReference: 'q-sandbox-1',
    sourceAsset: 'USD',
    destinationAsset: 'KRW',
    amount: '100000.00',
    beneficiaryRef: 'merchant-x',
    signedAt: '2026-03-01T09:00:00.000Z',
    signature: 'caller-supplied-signature',
    sandboxScenario: 'settle',
    ...overrides,
  };
}

describe('execution partners (PARTNER_LIVE_ENABLED default off)', () => {
  let harness: TestHarness;
  let token: string;
  let otherToken: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
      agentPayments: harness.container.persistence.agentPayments,
      auditLog: harness.container.persistence.auditLog,
    });
    token = await login(harness, DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    otherToken = await login(harness, OTHER_USER_EMAIL, OTHER_USER_PASSWORD);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('lists only sandbox mocks and publishes partnerLiveEnabled=false', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/execution-partners`,
    });
    expect(response.statusCode).toBe(200);
    const data = response.json<ApiEnvelope<PartnerCatalog>>().data;
    expect(data.partnerLiveEnabled).toBe(false);
    expect(data.livePartnersRegistered).toBe(false);
    expect(data.partners.length).toBe(3);
    expect(data.partners.every((partner) => partner.kind === 'sandbox_mock')).toBe(true);
    expect(data.partners.every((partner) => partner.live === false)).toBe(true);
    expect(data.partners.map((partner) => partner.partnerId).sort()).toEqual([
      'sandbox-partner-bank-fx',
      'sandbox-partner-psp-fx',
      'sandbox-partner-stablecoin-vasp',
    ]);
  });

  it('walks PSP dispatch → settling → settled', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/partner-instructions`,
      headers: { authorization: `Bearer ${token}` },
      payload: signedBody({ partnerId: 'sandbox-partner-psp-fx' }),
    });
    expect(created.statusCode).toBe(201);
    const first = created.json<ApiEnvelope<Instruction>>().data;
    expect(first.status).toBe('accepted');
    expect(first.fundsMoved).toBe(false);
    expect(first.meridianKeysUsed).toBe(false);

    const settling = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/partner-instructions/${first.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(settling.json<ApiEnvelope<Instruction>>().data.status).toBe('settling');

    const settled = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/partner-instructions/${first.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(settled.json<ApiEnvelope<Instruction>>().data).toMatchObject({
      status: 'settled',
      fundsMoved: false,
    });

    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'partner.dispatched')).toBe(true);
    expect(events.some((event) => event.type === 'partner.status_changed')).toBe(true);
    expect(JSON.stringify(events.filter((event) => event.type.startsWith('partner.')))).not.toContain(
      'caller-supplied-signature',
    );
  });

  it('simulates a failed dispatch for the fail scenario', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/partner-instructions`,
      headers: { authorization: `Bearer ${token}` },
      payload: signedBody({ partnerId: 'sandbox-partner-psp-fx', sandboxScenario: 'fail' }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().error.details['reason']).toBe('all_partners_failed');
    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'partner.failed')).toBe(true);
  });

  it('applies a webhook callback for the webhook scenario', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/partner-instructions`,
      headers: { authorization: `Bearer ${token}` },
      payload: signedBody({
        partnerId: 'sandbox-partner-stablecoin-vasp',
        sandboxScenario: 'webhook',
      }),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<ApiEnvelope<Instruction>>().data.id;
    await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/partner-instructions/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const webhook = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/partner-webhooks/sandbox-partner-stablecoin-vasp`,
      payload: { executionRef: id, status: 'settled', filledMinorUnits: '10000000' },
    });
    expect(webhook.statusCode).toBe(200);
    expect(webhook.json<ApiEnvelope<Instruction>>().data.status).toBe('settled');
  });

  it('returns 404 to another tenant', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/partner-instructions`,
      headers: { authorization: `Bearer ${token}` },
      payload: signedBody({ partnerId: 'sandbox-partner-psp-fx' }),
    });
    const id = created.json<ApiEnvelope<Instruction>>().data.id;
    const foreign = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/partner-instructions/${id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('rejects a live partner id because none are registered', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/partner-instructions`,
      headers: { authorization: `Bearer ${token}` },
      payload: signedBody({ partnerId: 'live-imagined-bank' }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().error.details['reason']).toBe('no_eligible_partner');
  });

  it('keeps POST /executions at 501', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(501);
  });
});

describe('PARTNER_LIVE_ENABLED=true still registers no live path', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness({ PARTNER_LIVE_ENABLED: 'true' });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('publishes the flag but lists zero live partners', async () => {
    const meta = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/meta` });
    expect(meta.json<{ data: { partnerLiveEnabled: boolean } }>().data.partnerLiveEnabled).toBe(
      true,
    );
    const catalog = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/execution-partners`,
    });
    const data = catalog.json<ApiEnvelope<PartnerCatalog>>().data;
    expect(data.livePartnersRegistered).toBe(false);
    expect(data.partners.every((partner) => partner.kind === 'sandbox_mock')).toBe(true);
  });
});
