import { describe, expect, it } from 'vitest';
import {
  DEMO_AGENT_SECRET,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_USER_EMAIL,
  OTHER_USER_PASSWORD,
} from './demo-tenant.js';
import {
  PRODUCTION_AUTH_SECRET_MIN_LENGTH,
  isDemoAgentSecret,
  isDemoEmail,
  isDemoLoginCredential,
  isDemoPassword,
  isForbiddenProductionSecret,
} from './production-credentials.js';

describe('production credential denylist', () => {
  it('rejects the documented demo password', () => {
    expect(isDemoPassword(DEMO_USER_PASSWORD)).toBe(true);
    expect(isForbiddenProductionSecret(DEMO_USER_PASSWORD)).toBe(true);
    expect(isDemoLoginCredential(DEMO_USER_EMAIL, DEMO_USER_PASSWORD)).toBe(true);
  });

  it('rejects the isolation-tenant demo password', () => {
    expect(isDemoPassword(OTHER_USER_PASSWORD)).toBe(true);
    expect(isForbiddenProductionSecret(OTHER_USER_PASSWORD)).toBe(true);
  });

  it('rejects the documented demo agent secret', () => {
    expect(isDemoAgentSecret(DEMO_AGENT_SECRET)).toBe(true);
    expect(isForbiddenProductionSecret(DEMO_AGENT_SECRET)).toBe(true);
  });

  it('rejects well-known default credential fallbacks without treating arbitrary secrets as demo', () => {
    expect(isForbiddenProductionSecret('changemechangemechangemechangeme')).toBe(true);
    expect(isForbiddenProductionSecret('passwordpasswordpasswordpassword')).toBe(true);
    expect(isForbiddenProductionSecret('dev-secret-dev-secret-dev-secret')).toBe(true);
    expect(isForbiddenProductionSecret('insecure-default-auth-secret-do-not-use')).toBe(true);
    expect(isForbiddenProductionSecret('')).toBe(true);

    const unique = `prod-${'x'.repeat(PRODUCTION_AUTH_SECRET_MIN_LENGTH)}`;
    expect(isForbiddenProductionSecret(unique)).toBe(false);
    expect(isDemoPassword(unique)).toBe(false);
    expect(isDemoAgentSecret(unique)).toBe(false);
  });

  it('rejects documented demo emails case-insensitively', () => {
    expect(isDemoEmail(DEMO_USER_EMAIL)).toBe(true);
    expect(isDemoEmail(DEMO_USER_EMAIL.toUpperCase())).toBe(true);
    expect(isDemoEmail(OTHER_USER_EMAIL)).toBe(true);
    expect(isDemoEmail('ops@unrelated.example')).toBe(false);
  });

  it('treats a production-looking email with a demo password as a demo login', () => {
    expect(isDemoLoginCredential('treasury@customer.example', DEMO_USER_PASSWORD)).toBe(true);
  });
});
