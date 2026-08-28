import {
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZATION_SLUG,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_USER_EMAIL,
  hashPassword,
  sessionScopesForRole,
  totpAt,
} from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeOidcClient } from '../auth/oidc-client.js';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from '../routes/index.js';
import { createTestHarness, type ApiEnvelope, type ApiError, type TestHarness } from '../testing/harness.js';

const MFA_ADMIN_EMAIL = 'mfa-admin@demo-trading.example.invalid';
const MFA_ADMIN_PASSWORD = 'MfaAdmin!2026';
const MFA_ADMIN_ID = 'usr_mfa_admin';
const ENFORCE_ADMIN_EMAIL = 'enforce-admin@demo-trading.example.invalid';
const ENFORCE_ADMIN_PASSWORD = 'EnforceAdmin!2026';
const ENFORCE_ADMIN_ID = 'usr_enforce_admin';
const MEMBER_EMAIL = 'mfa-member@demo-trading.example.invalid';
const MEMBER_PASSWORD = 'MfaMember!2026';
const MEMBER_ID = 'usr_mfa_member';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
  await provisionDemoTenants({
    identity: harness.container.persistence.identity,
    dashboard: harness.container.persistence.dashboard,
  });
  const identity = harness.container.persistence.identity;
  await identity.upsertUser({
    id: MFA_ADMIN_ID,
    email: MFA_ADMIN_EMAIL,
    displayName: 'MFA Admin',
    passwordHash: await hashPassword(MFA_ADMIN_PASSWORD),
  });
  await identity.upsertMembership({
    id: 'mbr_mfa_admin',
    organizationId: DEMO_ORGANIZATION_ID,
    userId: MFA_ADMIN_ID,
    role: 'admin',
  });
  await identity.upsertUser({
    id: ENFORCE_ADMIN_ID,
    email: ENFORCE_ADMIN_EMAIL,
    displayName: 'Enforce Admin',
    passwordHash: await hashPassword(ENFORCE_ADMIN_PASSWORD),
  });
  await identity.upsertMembership({
    id: 'mbr_enforce_admin',
    organizationId: DEMO_ORGANIZATION_ID,
    userId: ENFORCE_ADMIN_ID,
    role: 'admin',
  });
  await identity.upsertUser({
    id: MEMBER_ID,
    email: MEMBER_EMAIL,
    displayName: 'MFA Member',
    passwordHash: await hashPassword(MEMBER_PASSWORD),
  });
  await identity.upsertMembership({
    id: 'mbr_mfa_member',
    organizationId: DEMO_ORGANIZATION_ID,
    userId: MEMBER_ID,
    role: 'member',
  });
});

afterAll(async () => {
  await harness.close();
});

interface SessionBody {
  readonly token: string;
  readonly expiresAt: string;
  readonly role: string;
  readonly user: { readonly id: string; readonly email: string };
  readonly organization: { readonly id: string; readonly slug: string };
}

interface MfaChallengeBody {
  readonly mfaRequired: true;
  readonly challengeToken: string;
  readonly expiresAt: string;
}

async function login(
  email: string,
  password: string,
): Promise<{ status: number; body: SessionBody | MfaChallengeBody | ApiError['error'] }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `${API_V1_PREFIX}/auth/login`,
    payload: { email, password },
  });
  if (response.statusCode >= 400) {
    return { status: response.statusCode, body: response.json<ApiError>().error };
  }
  return {
    status: response.statusCode,
    body: response.json<ApiEnvelope<SessionBody | MfaChallengeBody>>().data,
  };
}

async function loginToken(email: string, password: string): Promise<string> {
  const result = await login(email, password);
  expect(result.status).toBe(201);
  const body = result.body as SessionBody;
  expect(body.token.startsWith('mds_')).toBe(true);
  return body.token;
}

function currentTotp(secret: string): string {
  return totpAt(secret, Math.floor(harness.clock.nowMs() / 1000));
}

async function scopesOf(token: string): Promise<readonly string[]> {
  const principal = await harness.container.authenticator.authenticate({
    authorization: `Bearer ${token}`,
    apiKey: null,
    declaredActor: null,
  });
  expect(principal?.verified).toBe(true);
  return principal?.scopes ?? [];
}

describe('password login without MFA or SSO', () => {
  it('still issues a session when the org has not enabled MFA or SSO', async () => {
    const result = await login(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    expect(result.status).toBe(201);
    const body = result.body as SessionBody;
    expect(body.token.startsWith('mds_')).toBe(true);
    expect(body.role).toBe('owner');
    expect(await scopesOf(body.token)).toEqual(sessionScopesForRole('owner'));
  });
});

describe('MFA enrollment and verification', () => {
  it('enrolls TOTP, verifies on login, rejects a wrong code, and consumes recovery codes once', async () => {
    const session = await loginToken(MFA_ADMIN_EMAIL, MFA_ADMIN_PASSWORD);

    const enroll = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/mfa/enroll`,
      headers: { authorization: `Bearer ${session}` },
    });
    expect(enroll.statusCode).toBe(200);
    const enrolled = enroll.json<
      ApiEnvelope<{ secret: string; otpauthUrl: string }>
    >().data;
    expect(enrolled.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enrolled.otpauthUrl).toContain(enrolled.secret);
    expect(JSON.stringify(enroll.json())).not.toContain('totpSecretCiphertext');

    const stored = await harness.container.persistence.identity.findUserMfa(MFA_ADMIN_ID);
    expect(stored?.pendingTotpSecretCiphertext).toBeTruthy();
    expect(stored?.pendingTotpSecretCiphertext).not.toContain(enrolled.secret);

    const confirm = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/mfa/confirm`,
      headers: { authorization: `Bearer ${session}` },
      payload: { code: currentTotp(enrolled.secret) },
    });
    expect(confirm.statusCode).toBe(200);
    const recoveryCodes = confirm.json<ApiEnvelope<{ recoveryCodes: string[] }>>().data
      .recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);

    const status = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/auth/mfa`,
      headers: { authorization: `Bearer ${session}` },
    });
    expect(status.json<ApiEnvelope<{ enrolled: boolean; remainingRecoveryCodes: number }>>().data).toEqual({
      enrolled: true,
      remainingRecoveryCodes: 10,
    });

    const challenged = await login(MFA_ADMIN_EMAIL, MFA_ADMIN_PASSWORD);
    expect(challenged.status).toBe(202);
    const challenge = challenged.body as MfaChallengeBody;
    expect(challenge.mfaRequired).toBe(true);
    expect(challenge.challengeToken.startsWith('mfc_')).toBe(true);

    const wrong = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/mfa/verify`,
      payload: { challengeToken: challenge.challengeToken, code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json<ApiError>().error.code).toBe('UNAUTHENTICATED');
    expect(wrong.body).not.toContain('000000');
    const mfaFailures = (await harness.auditEvents()).filter((event) => event.type === 'auth.mfa.failed');
    expect(mfaFailures.length).toBeGreaterThan(0);

    const ok = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/mfa/verify`,
      payload: { challengeToken: challenge.challengeToken, code: currentTotp(enrolled.secret) },
    });
    expect(ok.statusCode).toBe(201);
    const issued = ok.json<ApiEnvelope<SessionBody>>().data;
    expect(issued.token.startsWith('mds_')).toBe(true);
    expect(await scopesOf(issued.token)).toEqual(sessionScopesForRole('admin'));

    const again = await login(MFA_ADMIN_EMAIL, MFA_ADMIN_PASSWORD);
    const recoveryChallenge = again.body as MfaChallengeBody;
    const firstCode = recoveryCodes[0];
    const secondCode = recoveryCodes[1];
    expect(firstCode).toBeDefined();
    expect(secondCode).toBeDefined();

    const used = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/mfa/verify`,
      payload: { challengeToken: recoveryChallenge.challengeToken, code: firstCode },
    });
    expect(used.statusCode).toBe(201);

    const replayLogin = await login(MFA_ADMIN_EMAIL, MFA_ADMIN_PASSWORD);
    const replayChallenge = replayLogin.body as MfaChallengeBody;
    const reused = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/mfa/verify`,
      payload: { challengeToken: replayChallenge.challengeToken, code: firstCode },
    });
    expect(reused.statusCode).toBe(401);

    const second = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/mfa/verify`,
      payload: { challengeToken: replayChallenge.challengeToken, code: secondCode },
    });
    expect(second.statusCode).toBe(201);
  });
});

describe('org-level MFA enforcement', () => {
  it('fails closed for unenrolled owner/admin when the flag is on, and leaves members and flag-off logins alone', async () => {
    const ownerToken = await loginToken(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const enable = await harness.app.inject({
      method: 'PATCH',
      url: `${API_V1_PREFIX}/dashboard/settings/auth`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { requireMfaForPrivilegedRoles: true },
    });
    expect(enable.statusCode).toBe(200);

    const privileged = await login(ENFORCE_ADMIN_EMAIL, ENFORCE_ADMIN_PASSWORD);
    expect(privileged.status).toBe(403);
    expect((privileged.body as ApiError['error']).code).toBe('FORBIDDEN');

    const member = await login(MEMBER_EMAIL, MEMBER_PASSWORD);
    expect(member.status).toBe(201);

    const disable = await harness.app.inject({
      method: 'PATCH',
      url: `${API_V1_PREFIX}/dashboard/settings/auth`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { requireMfaForPrivilegedRoles: false },
    });
    expect(disable.statusCode).toBe(200);

    const restored = await login(ENFORCE_ADMIN_EMAIL, ENFORCE_ADMIN_PASSWORD);
    expect(restored.status).toBe(201);
  });
});

describe('OIDC federated login', () => {
  it('maps a federated identity onto the existing member, rejects unmapped emails, and issues the same scopes as password login', async () => {
    await harness.container.persistence.identity.updateOrganizationAuthSettings(DEMO_ORGANIZATION_ID, {
      requireMfaForPrivilegedRoles: false,
    });
    const ownerToken = await loginToken(DEMO_USER_EMAIL, DEMO_USER_PASSWORD);
    const oidc = harness.container.oidcClient;
    expect(oidc).toBeInstanceOf(FakeOidcClient);
    const fake = oidc as FakeOidcClient;

    const configure = await harness.app.inject({
      method: 'PATCH',
      url: `${API_V1_PREFIX}/dashboard/settings/auth`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        oidc: {
          issuer: 'https://idp.example.invalid',
          clientId: 'meridian-demo',
          clientSecret: 'oidc-client-secret-never-logged',
          redirectUri: 'http://127.0.0.1:43117/login/sso/callback',
          enabled: true,
        },
      },
    });
    expect(configure.statusCode).toBe(200);
    const publicSettings = configure.json<
      ApiEnvelope<{ oidc: { hasClientSecret: boolean; enabled: boolean; clientSecret?: string } }>
    >().data;
    expect(publicSettings.oidc.hasClientSecret).toBe(true);
    expect(publicSettings.oidc.enabled).toBe(true);
    expect(JSON.stringify(configure.json())).not.toContain('oidc-client-secret-never-logged');
    expect(JSON.stringify(configure.json())).not.toContain('clientSecretCiphertext');

    const listed = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/dashboard/settings`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(JSON.stringify(listed.json())).not.toContain('oidc-client-secret-never-logged');

    const start = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/oidc/start`,
      payload: { organizationSlug: DEMO_ORGANIZATION_SLUG },
    });
    expect(start.statusCode).toBe(200);
    const authorizationUrl = start.json<ApiEnvelope<{ authorizationUrl: string }>>().data
      .authorizationUrl;
    expect(authorizationUrl).toContain('https://idp.example.invalid/authorize');
    expect(fake.lastAuthorization).not.toBeNull();

    fake.codes.set('code-mapped', {
      email: MEMBER_EMAIL,
      subject: 'idp-member-1',
    });
    fake.codes.set('code-unknown', {
      email: 'nobody@example.invalid',
      subject: 'idp-nobody',
    });
    fake.codes.set('code-other-org', {
      email: OTHER_USER_EMAIL,
      subject: 'idp-other',
    });

    const mapped = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/oidc/callback`,
      payload: { code: 'code-mapped', state: fake.lastAuthorization?.state },
    });
    expect(mapped.statusCode).toBe(201);
    const ssoSession = mapped.json<ApiEnvelope<SessionBody>>().data;
    expect(ssoSession.user.email).toBe(MEMBER_EMAIL);
    expect(ssoSession.role).toBe('member');
    expect(ssoSession.organization.id).toBe(DEMO_ORGANIZATION_ID);

    const passwordSession = await loginToken(MEMBER_EMAIL, MEMBER_PASSWORD);
    expect(await scopesOf(ssoSession.token)).toEqual(await scopesOf(passwordSession));
    expect(await scopesOf(ssoSession.token)).toEqual(sessionScopesForRole('member'));
    expect(await scopesOf(ssoSession.token)).not.toContain('payment:create');
    expect(await scopesOf(ssoSession.token)).not.toContain('transaction:create');

    const startUnknown = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/oidc/start`,
      payload: { organizationSlug: DEMO_ORGANIZATION_SLUG },
    });
    const unknownState = (harness.container.oidcClient as FakeOidcClient).lastAuthorization?.state;
    expect(startUnknown.statusCode).toBe(200);
    const unmapped = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/oidc/callback`,
      payload: { code: 'code-unknown', state: unknownState },
    });
    expect(unmapped.statusCode).toBe(401);
    expect(unmapped.json<ApiError>().error.message).toMatch(/not mapped/i);

    const startOther = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/oidc/start`,
      payload: { organizationSlug: DEMO_ORGANIZATION_SLUG },
    });
    const otherState = (harness.container.oidcClient as FakeOidcClient).lastAuthorization?.state;
    expect(startOther.statusCode).toBe(200);
    const otherOrg = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/auth/oidc/callback`,
      payload: { code: 'code-other-org', state: otherState },
    });
    expect(otherOrg.statusCode).toBe(401);

    const ssoFailures = (await harness.auditEvents()).filter((event) => event.type === 'auth.sso.failed');
    expect(ssoFailures.length).toBeGreaterThan(0);
  });
});
