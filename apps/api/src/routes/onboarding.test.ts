import {
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OnboardingIncompleteError,
  buildOnboardingSnapshot,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { assertLicensedQuoteEligibility } from '../onboarding/eligibility.js';
import { createTestHarness, type ApiError, type TestHarness } from '../testing/harness.js';

const OPERATOR = 'unit-test-onboarding-operator-secret-ok';
const OPERATOR_HEADER = { 'x-onboarding-operator-key': OPERATOR };
const PREVIOUS_OPERATOR_SECRET = process.env['ONBOARDING_OPERATOR_SECRET'];

describe('B2B onboarding (PHASE 31)', () => {
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

  it('defaults a provisioned org to unverified, no pricing, and least privilege', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations`,
      headers: OPERATOR_HEADER,
      payload: {
        name: 'Northwind Treasury',
        slug: 'northwind-treasury',
        countryCode: 'sg',
        ownerEmail: 'owner@northwind.example.invalid',
        ownerDisplayName: 'Northwind Owner',
      },
    });
    expect(created.statusCode).toBe(201);
    const issued = created.json<{
      data: {
        organizationId: string;
        kybStatus: string;
        pricingConfigured: boolean;
        invite: { token: string; email: string };
      };
    }>().data;
    expect(issued.kybStatus).toBe('unverified');
    expect(issued.pricingConfigured).toBe(false);
    expect(issued.invite.token.startsWith('miv_')).toBe(true);

    const accepted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/onboarding/invites/accept`,
      payload: { token: issued.invite.token, password: 'NorthwindOwner!2026' },
    });
    expect(accepted.statusCode).toBe(201);

    const login = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: 'owner@northwind.example.invalid', password: 'NorthwindOwner!2026' },
    });
    expect(login.statusCode).toBe(201);
    const token = login.json<{ data: { token: string } }>().data.token;

    const checklist = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/onboarding`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(checklist.statusCode).toBe(200);
    const snapshot = checklist.json<{
      data: {
        kybStatus: string;
        pricingConfigured: boolean;
        apiKeyIssued: boolean;
        realTransactionEligible: boolean;
        mode: string;
        kybVendor: string;
      };
    }>().data;
    expect(snapshot.mode).toBe('sales_assisted_invite_only');
    expect(snapshot.kybVendor).toBe('manual_review');
    expect(snapshot.kybStatus).toBe('unverified');
    expect(snapshot.pricingConfigured).toBe(false);
    expect(snapshot.apiKeyIssued).toBe(false);
    expect(snapshot.realTransactionEligible).toBe(false);

    const sandboxQuote = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '1000.00' },
    });
    expect(sandboxQuote.statusCode).toBe(201);
  });

  it('rejects operator calls without the operator secret', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations`,
      payload: {
        name: 'Nope',
        slug: 'nope-org',
        countryCode: 'US',
        ownerEmail: 'a@b.example.invalid',
        ownerDisplayName: 'A',
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a wrong operator secret with the same 401', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations`,
      headers: { 'x-onboarding-operator-key': 'definitely-not-the-operator-secret-value' },
      payload: {
        name: 'Nope',
        slug: 'nope-org-wrong-key',
        countryCode: 'US',
        ownerEmail: 'wrong@b.example.invalid',
        ownerDisplayName: 'A',
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('submits KYB for manual review, rejects, then verifies with an audited reason', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations`,
      headers: OPERATOR_HEADER,
      payload: {
        name: 'Cedar Imports',
        slug: 'cedar-imports',
        countryCode: 'GB',
        ownerEmail: 'ops@cedar.example.invalid',
        ownerDisplayName: 'Cedar Ops',
      },
    });
    const issued = created.json<{
      data: { organizationId: string; invite: { token: string } };
    }>().data;
    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/onboarding/invites/accept`,
      payload: { token: issued.invite.token, password: 'CedarImports!2026' },
    });
    const login = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: 'ops@cedar.example.invalid', password: 'CedarImports!2026' },
    });
    const token = login.json<{ data: { token: string } }>().data.token;

    const submitted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/dashboard/onboarding/kyb/submit`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json<{ data: { kybStatus: string } }>().data.kybStatus).toBe('pending');

    const rejected = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations/${issued.organizationId}/kyb`,
      headers: OPERATOR_HEADER,
      payload: { status: 'rejected', reason: 'Incomplete incorporation documents' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json<{ data: { kybStatus: string } }>().data.kybStatus).toBe('rejected');

    const stillBlocked = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/onboarding`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stillBlocked.json<{ data: { realTransactionEligible: boolean } }>().data.realTransactionEligible).toBe(
      false,
    );

    const verified = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations/${issued.organizationId}/kyb`,
      headers: OPERATOR_HEADER,
      payload: { status: 'verified', reason: 'Manual review of incorporation pack 2026-03-01' },
    });
    expect(verified.statusCode).toBe(200);

    const priced = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations/${issued.organizationId}/pricing`,
      headers: OPERATOR_HEADER,
      payload: { markupBps: '12.5' },
    });
    expect(priced.statusCode).toBe(201);

    const ready = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/onboarding`,
      headers: { authorization: `Bearer ${token}` },
    });
    const readyBody = ready.json<{
      data: { realTransactionEligible: boolean; pricingConfigured: boolean; kybStatus: string };
    }>().data;
    expect(readyBody.kybStatus).toBe('verified');
    expect(readyBody.pricingConfigured).toBe(true);
    expect(readyBody.realTransactionEligible).toBe(true);

    const events = await harness.auditEvents();
    const kybReviews = events.filter((event) => event.type === 'onboarding.kyb.reviewed');
    expect(kybReviews.some((event) => event.payload['status'] === 'rejected')).toBe(true);
    expect(kybReviews.some((event) => event.payload['reason'] === 'Manual review of incorporation pack 2026-03-01')).toBe(
      true,
    );
    expect(JSON.stringify(events)).not.toContain(OPERATOR);
  });

  it('does not treat KYB verified without explicit pricing as eligible', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations`,
      headers: OPERATOR_HEADER,
      payload: {
        name: 'Bare Corp',
        slug: 'bare-corp',
        countryCode: 'IE',
        ownerEmail: 'owner@bare.example.invalid',
        ownerDisplayName: 'Bare Owner',
      },
    });
    const orgId = created.json<{ data: { organizationId: string } }>().data.organizationId;
    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations/${orgId}/kyb`,
      headers: OPERATOR_HEADER,
      payload: { status: 'verified', reason: 'KYB only, pricing not yet contracted' },
    });
    const token = created.json<{ data: { invite: { token: string } } }>().data.invite.token;
    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/onboarding/invites/accept`,
      payload: { token, password: 'BareOwnerPass!26' },
    });
    const login = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: 'owner@bare.example.invalid', password: 'BareOwnerPass!26' },
    });
    const session = login.json<{ data: { token: string } }>().data.token;
    const snapshot = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/onboarding`,
      headers: { authorization: `Bearer ${session}` },
    });
    expect(snapshot.json<{ data: { realTransactionEligible: boolean; pricingConfigured: boolean } }>().data).toMatchObject(
      { realTransactionEligible: false, pricingConfigured: false },
    );
  });

  it('keeps POST /executions at 501 during onboarding', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/executions`,
    });
    expect(response.statusCode).toBe(501);
    expect(response.json<ApiError>().error.code).toBe('EXECUTION_NOT_IMPLEMENTED');
  });

  it('lets the sandbox demo tenant keep exploring without KYB', async () => {
    const login = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
    });
    expect(login.statusCode).toBe(201);
    const token = login.json<{ data: { token: string } }>().data.token;
    const quoted = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/quote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sourceAsset: 'USD', destinationAsset: 'EUR', amount: '500.00' },
    });
    expect(quoted.statusCode).toBe(201);
  });

  it('treats an explicit zero markup as configured pricing, not a silent default', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations`,
      headers: OPERATOR_HEADER,
      payload: {
        name: 'Zero Markup Co',
        slug: 'zero-markup-co',
        countryCode: 'NL',
        ownerEmail: 'owner@zero.example.invalid',
        ownerDisplayName: 'Zero Owner',
      },
    });
    const issued = created.json<{
      data: { organizationId: string; invite: { token: string } };
    }>().data;
    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/onboarding/invites/accept`,
      payload: { token: issued.invite.token, password: 'ZeroMarkupOwner!26' },
    });
    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations/${issued.organizationId}/kyb`,
      headers: OPERATOR_HEADER,
      payload: { status: 'verified', reason: 'Manual KYB; contracted zero take-rate' },
    });
    const priced = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/onboarding/organizations/${issued.organizationId}/pricing`,
      headers: OPERATOR_HEADER,
      payload: { markupBps: '0' },
    });
    expect(priced.statusCode).toBe(201);
    const login = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/login`,
      payload: { email: 'owner@zero.example.invalid', password: 'ZeroMarkupOwner!26' },
    });
    const session = login.json<{ data: { token: string } }>().data.token;
    const snapshot = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/onboarding`,
      headers: { authorization: `Bearer ${session}` },
    });
    expect(
      snapshot.json<{ data: { pricingConfigured: boolean; realTransactionEligible: boolean } }>()
        .data,
    ).toMatchObject({ pricingConfigured: true, realTransactionEligible: true });
  });
});

describe('production-locked onboarding gate', () => {
  it('blocks licensed quotes for an unverified org without a silent default rate', () => {
    const snapshot = buildOnboardingSnapshot({
      organizationId: 'org_gate_unverified',
      kybStatus: 'unverified',
      kybReason: null,
      kybReviewedAt: null,
      pricingConfigured: false,
      apiKeyIssued: false,
      licensedProviderConfigured: false,
    });
    expect(snapshot.realTransactionEligible).toBe(false);
    expect(() => assertLicensedQuoteEligibility(true, snapshot)).toThrow(OnboardingIncompleteError);
    expect(() => assertLicensedQuoteEligibility(true, null)).toThrow(OnboardingIncompleteError);
    expect(() => assertLicensedQuoteEligibility(false, snapshot)).not.toThrow();
  });
});
