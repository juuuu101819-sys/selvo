import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEMO_AGENT_ID,
  DEMO_ORGANIZATION_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  hashPassword,
  isRealTransactionEligible,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiError, type TestHarness } from '../testing/harness.js';

const MEMBER_EMAIL = 'member-exec-auth@demo-trading.example.invalid';
const MEMBER_PASSWORD = 'member-exec-auth-pass-ok';

describe('PHASE 38 execution-authorization flags', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
      agentPayments: harness.container.persistence.agentPayments,
    });
    await harness.container.persistence.identity.upsertUser({
      id: 'usr_exec_member',
      email: MEMBER_EMAIL,
      displayName: 'Exec Member',
      passwordHash: await hashPassword(MEMBER_PASSWORD),
    });
    await harness.container.persistence.identity.upsertMembership({
      id: 'mbr_exec_member',
      organizationId: DEMO_ORGANIZATION_ID,
      userId: 'usr_exec_member',
      role: 'member',
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  async function login(email: string, password: string): Promise<string> {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email, password },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ data: { token: string } }>().data.token;
  }

  it('defaults organization and agent flags to false', async () => {
    const token = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const settings = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/settings`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(settings.json<{ data: { organization: { executionAuthorized: boolean } } }>().data.organization
      .executionAuthorized).toBe(false);

    const agents = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/agents`,
      headers: { authorization: `Bearer ${token}` },
    });
    const demo = agents
      .json<{ data: { agents: { id: string; executionAuthorized: boolean }[] } }>()
      .data.agents.find((agent) => agent.id === DEMO_AGENT_ID);
    expect(demo?.executionAuthorized).toBe(false);
  });

  it('lets only owner/admin set the organization flag, audits, and keeps executions at 501', async () => {
    const memberToken = await login(MEMBER_EMAIL, MEMBER_PASSWORD);
    const forbidden = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/dashboard/execution-authorization`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { authorized: true, agreementReference: 'ToS-draft-0' },
    });
    expect(forbidden.statusCode).toBe(403);

    const ownerToken = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const missingRef = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/dashboard/execution-authorization`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { authorized: true },
    });
    expect(missingRef.statusCode).toBe(400);

    const set = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/dashboard/execution-authorization`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { authorized: true, agreementReference: 'ToS-draft-0' },
    });
    expect(set.statusCode).toBe(200);
    const body = set.json<{
      data: { executionAuthorized: boolean; functionalEffect: string; executionsRemain501: boolean };
    }>().data;
    expect(body.executionAuthorized).toBe(true);
    expect(body.functionalEffect).toBe('none');
    expect(body.executionsRemain501).toBe(true);

    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'organization.execution_authorization.updated')).toBe(
      true,
    );

    const executed = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(executed.statusCode).toBe(501);
    expect(executed.json<ApiError>().error.code).toBe('EXECUTION_NOT_IMPLEMENTED');

    expect(isRealTransactionEligible({ kybStatus: 'verified', pricingConfigured: true })).toBe(true);
    expect(isRealTransactionEligible({ kybStatus: 'unverified', pricingConfigured: false })).toBe(
      false,
    );
  });

  it('lets only owner/admin set the agent flag and audits it', async () => {
    const memberToken = await login(MEMBER_EMAIL, MEMBER_PASSWORD);
    const forbidden = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/dashboard/agents/${DEMO_AGENT_ID}/execution-authorization`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { authorized: true, agreementReference: 'agent-mandate-draft' },
    });
    expect(forbidden.statusCode).toBe(403);

    const ownerToken = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const set = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/dashboard/agents/${DEMO_AGENT_ID}/execution-authorization`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { authorized: true, agreementReference: 'agent-mandate-draft' },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json<{ data: { executionAuthorized: boolean; functionalEffect: string } }>().data).toMatchObject({
      executionAuthorized: true,
      functionalEffect: 'none',
    });

    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'agent.execution_authorization.updated')).toBe(true);

    const executed = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(executed.statusCode).toBe(501);
  });

  it('does not consult executionAuthorized in execution or eligibility code', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const forbiddenFiles = [
      'apps/api/src/routes/executions.ts',
      'apps/api/src/onboarding/eligibility.ts',
      'packages/core/src/domain/onboarding.ts',
      'apps/api/src/routes/financial-routing.ts',
    ];
    for (const relative of forbiddenFiles) {
      const source = readFileSync(join(root, relative), 'utf8');
      expect(source, relative).not.toContain('executionAuthorized');
    }
  });
});
