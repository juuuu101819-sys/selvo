import {
  DEMO_AGENT_SECRET,
  DEMO_USER_EMAIL,
  DEMO_USER_PASSWORD,
  OTHER_USER_EMAIL,
  OTHER_USER_PASSWORD,
} from './demo-tenant.js';

/**
 * Documented sandbox credentials and well-known default secrets.
 *
 * Compared as exact, case-insensitive trimmed strings so a production secret is never rejected
 * merely for containing a common word. Values are never logged by callers.
 */
const WELL_KNOWN_DEFAULT_SECRETS: readonly string[] = [
  'password',
  'secret',
  'changeme',
  'admin',
  'default',
  'demo',
  'test',
  'development',
  'production',
  'auth_secret',
  'AUTH_SECRET',
  'changemechangemechangemechangeme',
  'passwordpasswordpasswordpassword',
  'secretsecretsecretsecretsecretse',
  'dev-secret-dev-secret-dev-secret',
  'test-secret-test-secret-test-sec',
  'insecure-default-auth-secret-do-not-use',
];

const FORBIDDEN_PRODUCTION_SECRETS: readonly string[] = [
  DEMO_USER_PASSWORD,
  OTHER_USER_PASSWORD,
  DEMO_AGENT_SECRET,
  ...WELL_KNOWN_DEFAULT_SECRETS,
];

const DEMO_EMAILS: readonly string[] = [DEMO_USER_EMAIL, OTHER_USER_EMAIL];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** True when `value` is a documented demo password, demo agent secret, or default credential. */
export function isForbiddenProductionSecret(value: string): boolean {
  const needle = normalize(value);
  if (needle === '') {
    return true;
  }
  return FORBIDDEN_PRODUCTION_SECRETS.some((item) => normalize(item) === needle);
}

export function isDemoPassword(value: string): boolean {
  const needle = normalize(value);
  return needle === normalize(DEMO_USER_PASSWORD) || needle === normalize(OTHER_USER_PASSWORD);
}

export function isDemoEmail(email: string): boolean {
  const needle = normalize(email);
  return DEMO_EMAILS.some((item) => normalize(item) === needle);
}

export function isDemoAgentSecret(value: string): boolean {
  return normalize(value) === normalize(DEMO_AGENT_SECRET);
}

/**
 * True when a login attempt uses a documented sandbox email or password.
 *
 * Production login must treat this as an authentication failure with the same generic 401 as any
 * other wrong credential — never as a distinct "demo disabled" signal that would enumerate accounts.
 */
export function isDemoLoginCredential(email: string, password: string): boolean {
  return isDemoEmail(email) || isDemoPassword(password) || isForbiddenProductionSecret(password);
}

export const PRODUCTION_AUTH_SECRET_MIN_LENGTH = 32;
