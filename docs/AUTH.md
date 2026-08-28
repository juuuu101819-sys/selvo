# Authentication — sessions, MFA, and SSO

This document describes how a **human session** is obtained. It does not change what a session can
do. After a session exists, `IdentityAuthenticator` still resolves `mds_` tokens to a `Principal`
whose scopes come from `sessionScopesForRole` (PA-H02). Agent credentials (`mag_`) and organization
API keys (`mk_`) are unchanged and never enter the MFA or OIDC flows. See [AGENTS.md](./AGENTS.md).

`POST /api/v1/executions` remains 501.

## Defaults

MFA and SSO are **off** until an organization turns them on. Password login for the demo tenant and
for any org that has not enrolled users or enabled OIDC is unchanged: `POST /api/v1/auth/login`
returns `201` and a session token.

SCIM is not implemented.

## Password login

`POST /api/v1/auth/login` with `{ email, password }`.

- Unknown email and wrong password share one `401 UNAUTHENTICATED` message.
- Demo credentials are rejected when the process is production-locked.
- On success, if MFA does not apply, the handler calls the same session issuer used by MFA verify
  and OIDC callback: HMAC-hashed `mds_` token, 12-hour expiry, scopes from the membership role.

## MFA (TOTP)

Optional per user. Organizations may require it for `owner` and `admin` only.

### Enrollment

Signed-in human session:

1. `POST /api/v1/auth/mfa/enroll` — returns `{ secret, otpauthUrl, issuer }` once. The TOTP seed is
   stored as AES-256-GCM ciphertext derived from `AUTH_SECRET`. It is never logged and never stored
   in plaintext.
2. `POST /api/v1/auth/mfa/confirm` with `{ code }` — activates MFA and returns ten recovery codes
   once. Each recovery code is stored as a salted scrypt hash (`hashCredential`), the same KDF as
   API keys.

`GET /api/v1/auth/mfa` returns `{ enrolled, remainingRecoveryCodes }`.

`POST /api/v1/auth/mfa/recovery/regenerate` with a current TOTP code replaces unused recovery codes
and returns the new set once.

### Login

After a correct password:

| User enrolled | Org `requireMfaForPrivilegedRoles` | Role | Result |
| ------------- | --------------------------------- | ---- | ------ |
| no | off (default) | any | `201` session |
| no | on | owner/admin | `403` — enroll while the flag is off, then enable it |
| no | on | member/viewer | `201` session |
| yes | any | any | `202` `{ mfaRequired, challengeToken, expiresAt }` |

`POST /api/v1/auth/mfa/verify` with `{ challengeToken, code }` accepts a six-digit TOTP or a
single-use recovery code (`XXXX-XXXX`). Success issues the **same** session DTO as password login
(`201`). A used recovery code cannot be reused. Wrong codes are `401` with a generic message;
`auth.mfa.failed` is recorded without the code.

The challenge token is hashed (HMAC, same pepper as sessions). Raw TOTP secrets and codes are never
persisted.

### Org policy

`PATCH /api/v1/dashboard/settings/auth` `{ "requireMfaForPrivilegedRoles": true }` is owner/admin
only (`requireKeyManager`). Off by default.

## SSO (OpenID Connect)

Org-level generic OIDC: issuer, client ID, client secret, redirect URI, enabled flag. SAML is not
implemented.

### Configure

Owner/admin `PATCH /api/v1/dashboard/settings/auth`:

```json
{
  "oidc": {
    "issuer": "https://idp.example.com",
    "clientId": "meridian",
    "clientSecret": "…",
    "redirectUri": "http://127.0.0.1:43117/login/sso/callback",
    "enabled": true
  }
}
```

The client secret is encrypted at rest with the same AES-256-GCM key as TOTP seeds. GET settings
returns `hasClientSecret: true` and never the secret. SSO cannot be enabled without a stored
secret.

Redirect URI for the web app is `/login/sso/callback`.

### Login

1. `POST /api/v1/auth/oidc/start` `{ "organizationSlug": "demo-trading-co" }` — returns
   `authorizationUrl` when SSO is enabled for that org. Missing org, disabled SSO, or missing
   secret share one `401` ("SSO is not available for this organization.").
2. The browser follows the IdP, then returns to the redirect URI with `code` and `state`.
3. `POST /api/v1/auth/oidc/callback` `{ "code", "state" }` exchanges the code. Email from the ID
   token must match an **existing** `User` who already has an **active** `OrganizationMember` in
   that organization. Unmapped identities are `401` — no user is created, no default role is
   granted.
4. On success the same PA-H02 session is issued as password login for that role.

OIDC state is hashed; the nonce is encrypted so the ID token can be checked. Authorization-code
exchange uses OIDC discovery (`/.well-known/openid-configuration`) and JWKS verification in
production. Tests inject an in-process fake IdP.

## What is not in this phase

- SCIM provisioning
- SAML
- Auto-creating users from an IdP
- MFA on `mag_` / `mk_` credentials
- A second session or identity model
