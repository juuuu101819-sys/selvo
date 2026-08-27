import { describe, expect, it } from 'vitest';
import { DEMO_AGENT_ID, DEMO_AGENT_POLICY, DEMO_ORGANIZATION_ID } from '../auth/demo-tenant.js';
import { demoAgentPaymentIntents } from '../auth/demo-agent-dashboard.js';
import type { PaymentPolicy, PublicAgent } from '../domain/agent-payments.js';
import { buildAgentDashboardDetail, summarizeAgentDashboard, violationFromAuditPayload } from './agent-dashboard.js';

const agent: PublicAgent = {
  id: DEMO_AGENT_ID,
  organizationId: DEMO_ORGANIZATION_ID,
  name: 'Demo Treasury Agent',
  status: 'active',
  createdAt: '2026-03-01T09:00:00.000Z',
  keyPrefix: 'mag_demo_agent01',
  scopes: [],
  credentialExpiresAt: null,
  credentialRevokedAt: null,
};

const policy: PaymentPolicy = {
  id: 'pol_demo_treasury',
  organizationId: DEMO_ORGANIZATION_ID,
  agentId: DEMO_AGENT_ID,
  ...DEMO_AGENT_POLICY,
  allowedAssets: [...DEMO_AGENT_POLICY.allowedAssets],
  allowedRecipientCodes: [...DEMO_AGENT_POLICY.allowedRecipientCodes],
  allowedProviderIds: [...DEMO_AGENT_POLICY.allowedProviderIds],
  allowedChainIds: [...DEMO_AGENT_POLICY.allowedChainIds],
  allowedCountryCodes: [...DEMO_AGENT_POLICY.allowedCountryCodes],
  preferredRoutePreference: 'lowest_cost',
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z',
};

describe('summarizeAgentDashboard', () => {
  it('computes volume, average fee and success rate with Decimal arithmetic', () => {
    const intents = demoAgentPaymentIntents('2026-08-27T12:00:00.000Z').filter(
      (row) => row.organizationId === DEMO_ORGANIZATION_ID,
    );
    const summary = summarizeAgentDashboard({
      agent,
      intents,
      policy,
      dailySpentMinorUnits: '50000',
      violations: [
        {
          eventId: 'evt_1',
          occurredAt: '2026-08-27T09:05:00.000Z',
          agentId: DEMO_AGENT_ID,
          rule: 'maximum_transaction_amount',
          message: 'Amount exceeds the agent policy maximum transaction amount.',
          paymentIntentId: 'pay_demo_failed_policy',
        },
      ],
    });
    expect(summary.fundsMoved).toBe(false);
    expect(summary.custody).toBe(false);
    expect(summary.transactionCount).toBe(5);
    expect(summary.completedCount).toBe(3);
    expect(summary.failedCount).toBe(1);
    expect(summary.paymentVolumeMinorUnits).toBe('425000');
    expect(summary.averageFeeBps).toBe('42.5000');
    expect(summary.routeSuccessRatePercent).toBe('75.0');
    expect(summary.policyViolationCount).toBe(1);
    expect(summary.preferredRoute?.providerId).toBe('sandbox-veridian-payments');
    expect(summary.dailySpentMinorUnits).toBe('50000');
  });

  it('does not mix another organization\'s intents into the totals', () => {
    const summary = summarizeAgentDashboard({
      agent,
      intents: demoAgentPaymentIntents('2026-08-27T12:00:00.000Z'),
      policy,
      dailySpentMinorUnits: '0',
      violations: [],
    });
    expect(summary.paymentVolumeMinorUnits).toBe('425000');
    expect(summary.transactionCount).toBe(5);
  });
});

describe('buildAgentDashboardDetail', () => {
  it('never claims custody, keys or generated wallets', () => {
    const detail = buildAgentDashboardDetail({
      agent,
      intents: demoAgentPaymentIntents('2026-08-27T12:00:00.000Z'),
      policy,
      dailySpentMinorUnits: '50000',
      violations: [],
    });
    expect(detail.fundsMoved).toBe(false);
    expect(detail.custody).toBe(false);
    expect(detail.walletsGenerated).toBe(false);
    expect(detail.privateKeysHeld).toBe(false);
    expect(detail.spending?.dailyRemainingMinorUnits).toBe('950000');
    expect(detail.preferredRoutes[0]?.intentCount).toBe(3);
  });
});

describe('violationFromAuditPayload', () => {
  it('drops denials that belong to another organization or agent', () => {
    expect(
      violationFromAuditPayload({
        eventId: 'evt_other_policy_secret',
        occurredAt: '2026-08-27T09:05:00.000Z',
        payload: {
          agentId: 'agt_other_secret',
          organizationId: 'org_acme_other',
          rule: 'allowed_assets',
          message: 'secret',
        },
        organizationId: DEMO_ORGANIZATION_ID,
        agentId: DEMO_AGENT_ID,
      }),
    ).toBeNull();
  });
});
