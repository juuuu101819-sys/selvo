# Agent credentials

This document describes **how Meridian actually issues, scopes, and revokes AI-agent credentials**.
It matches `POST /api/v1/agents` in `apps/api/src/routes/agent-payments.ts` and the PA-H02
scope-per-role model in `packages/core/src/domain/api-scope.ts`. It does not describe a future
issuance product.

Meridian remains non-custodial. An agent credential authorizes **quotes, payment intents, policy
evaluation, and sandbox simulation**. It does not move funds, hold keys, or control wallets.
`POST /api/v1/executions` stays 501.

## What an agent is

An **agent** is an organization-scoped machine principal (`Principal.kind === 'agent'`,
`economicActor: 'ai_agent'`). It authenticates with a secret that starts with `mag_`, presented as
`X-Api-Key` or `Authorization: Bearer mag_…`.

An agent is **not**:

| Credential | Prefix | Who | Typical scopes |
| ---------- | ------ | --- | -------------- |
| Human session | `mds_` | Owner/admin/member/viewer | Role-derived: `quote:read`, `route:read`; owner/admin also `agent_policy:write`. **Never** `payment:*` or `transaction:create`. |
| Organization API key | `mk_` | Business/service | Default `quote:read` + `route:read`. Optional explicit `transaction:create`. **Never** `payment:*` or `agent_policy:write`. |
| Agent credential | `mag_` | AI agent acting *for* the organization | Always `quote:read`, `payment:create`, `payment:quote`, `payment:authorize`. **Never** `agent_policy:write` or `transaction:create`. |

Callers that present no credential remain anonymous on public discovery routes. A credential that
cannot be verified is `401 UNAUTHENTICATED`, never silently treated as anonymous.

Human MFA and OIDC change only how an `mds_` session is obtained. They do not apply to `mag_` or
`mk_` credentials and they do not change `DEFAULT_AGENT_SCOPES`. See [AUTH.md](./AUTH.md).

## Issuance (`POST /api/v1/agents`)

**Who:** an owner or admin **human session** (`requireKeyManager`). Organization `mk_` keys and
`mag_` credentials receive `403 FORBIDDEN`. Viewer/member sessions receive `403`.

**Body:** `{ "name": "…" }` only. Scopes are **not** caller-selectable.

**What the handler does, in order:**

1. Creates an agent row (`agt_…`, status `active`).
2. Generates `randomToken('mag_')`. The raw secret is returned **once** on this response as
   `secret`. It is hashed with per-credential salted scrypt (`hashCredential`) before persist.
   The first 16 characters are stored as `keyPrefix` for display. The hash is never returned.
3. Stores scopes **exactly** `DEFAULT_AGENT_SCOPES`:
   `quote:read`, `payment:create`, `payment:quote`, `payment:authorize`.
   There is no API to add `agent_policy:write` or `transaction:create` to a `mag_` credential.
4. Creates one **external account reference** (`controlledByPlatform: false`) labelled
   “External operating account”. The platform does not generate keys or hold the account.
   Making this row optional is deferred (would change `POST /agents` issuance).
5. Creates a payment policy copied from `DEMO_AGENT_POLICY` (limits, allowlists, and
   `preferredRoutePreference: 'lowest_cost'`), with `allowedRecipientCodes` set to this
   organization's merchants.
6. Writes audit event `agent.issued` with `agentId`, `keyPrefix`, and scopes — never the secret.

Subsequent `GET /api/v1/agents` and `GET /api/v1/agents/me` return prefixes and scopes, never the
raw secret. If the secret is lost, **revoke and issue a new agent** — there is no rotate-in-place
endpoint (see [Rotation](#rotation-and-revocation)).

## Using the credential

Send `X-Api-Key: mag_…` (or Bearer). `GET /api/v1/agents/me` returns the agent plus external
account references.

Payment flow (all non-custodial):

```
POST /payment-intents            payment:create
POST /payment-intents/:id/quote  payment:quote     → MultiRailRouter + policy ranking input
POST /payment-intents/:id/select payment:authorize → preferredRoutePreference is enforced when set
POST /payment-intents/:id/authorize
POST /payment-intents/:id/simulate                 → fundsMoved stays false
```

Agents may also call `POST /api/v1/quote` (`quote:read`) and the NL endpoints
(`POST /api/v1/agent/interpret`, `POST /api/v1/agent/route`). They cannot PATCH payment policy.
They cannot mint `mk_` keys.

Policy evaluation is fail-closed at create, quote, select, authorize, simulate, and immediately
before an execution intent is recorded. Empty provider/asset/recipient/country allowlists mean
**none**, not all. `preferredRoutePreference`, when set, is the ranking-weight input to the single
`MultiRailRouter` and a select-time lock to the recommended route.

## Rotation and revocation

**Revoke:** `POST /api/v1/agents/:id/revoke` (owner/admin session). Sets agent status `retired` and
revokes every credential for that agent. A later request with the old secret is `401`.

**Rotate:** there is no `POST /agents/:id/rotate`. Issue a new agent (`POST /api/v1/agents`),
migrate callers to the new `mag_` secret, then revoke the old agent. Documented here so integrators
do not assume an unpublished rotate endpoint.

**Expiry:** issued credentials are stored with `expiresAt: null`. There is no TTL on mint. Revocation
is the only implemented invalidation besides process-level production gates that refuse demo
secrets.

## Gaps (code, not aspiration)

- Scopes on mint are a fixed constant. Operators cannot narrow a `mag_` key to `quote:read` only.
- External account references are labels pointing outside the platform; the handler always creates one
  default row. It is not a custodian wallet and is not optional on mint.
- Demo sandbox still provisions `DEMO_AGENT_SECRET` (`mag_demo_agent01_…`) when demo tenants are
  allowed. Production-locked processes reject that seed (PA-C02).
- Agent-to-agent settlement and treasury automation are **not** implemented.

## Related

- HTTP surface: [API.md](./API.md)
- OpenAPI: `GET /api/v1/openapi.json`
- Scope model: `packages/core/src/domain/api-scope.ts` (PA-H02)
- Issuance handler: `apps/api/src/routes/agent-payments.ts`
