/**
 * Documented sandbox login. Matches `packages/core` demo-tenant constants.
 *
 * These are not a production secret: they authenticate only the in-process demo organization in
 * sandbox mode. The password is printed on the login page so local development does not depend on
 * a shared vault.
 */
export const DEMO_LOGIN = {
  email: 'treasury@demo-trading.example.invalid',
  password: 'MeridianDemo!2026',
  organization: 'Meridian Demo Trading Co',
} as const;
