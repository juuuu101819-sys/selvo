/**
 * Local-development tenant.
 *
 * These credentials are documented, committed, and safe: they authenticate only the demo
 * organization in sandbox mode. They must never be accepted as a production login.
 */
export const DEMO_ORGANIZATION_ID = 'org_demo_meridian';
export const DEMO_USER_ID = 'usr_demo_treasury';
export const DEMO_MEMBERSHIP_ID = 'mbr_demo_owner';
export const DEMO_ORGANIZATION_SLUG = 'demo-trading-co';
export const DEMO_ORGANIZATION_NAME = 'Meridian Demo Trading Co';
export const DEMO_USER_EMAIL = 'treasury@demo-trading.example.invalid';
export const DEMO_USER_DISPLAY_NAME = 'Demo Treasury Operator';
/** Documented sandbox password. Not a production secret. */
export const DEMO_USER_PASSWORD = 'MeridianDemo!2026';

/** A second tenant used only to prove isolation. Never returned to the demo user. */
export const OTHER_ORGANIZATION_ID = 'org_acme_other';
export const OTHER_USER_ID = 'usr_acme_other';
export const OTHER_USER_EMAIL = 'ops@acme-other.example.invalid';
export const OTHER_USER_PASSWORD = 'OtherOrg!2026';
export const OTHER_ORGANIZATION_NAME = 'Acme Other Co';
