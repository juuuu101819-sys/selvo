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

/** Documented sandbox agent. Credential is hashed at provision; plaintext is never stored. */
export const DEMO_AGENT_ID = 'agt_demo_treasury';
export const DEMO_AGENT_NAME = 'Demo Treasury Agent';
/**
 * Sandbox-only agent credential, same class of secret as {@link DEMO_USER_PASSWORD}.
 * Prefix (first 16 characters) is `mag_demo_agent01`.
 */
export const DEMO_AGENT_SECRET = 'mag_demo_agent01_sandbox_only_not_production';
export const DEMO_AGENT_CREDENTIAL_ID = 'agc_demo_treasury';
export const DEMO_WALLET_REFERENCE_ID = 'awr_demo_treasury';
export const DEMO_MERCHANT_ID = 'mrc_demo_merchant_x';
export const DEMO_MERCHANT_CODE = 'merchant-x';
export const DEMO_MERCHANT_NAME = 'Merchant X';
export const DEMO_PAYMENT_POLICY_ID = 'pol_demo_treasury';
