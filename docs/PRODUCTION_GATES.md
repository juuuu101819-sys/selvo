# Meridian — Production gates

Fail-closed configuration for any process labelled production. This document is the operator
contract for PA-C01, PA-C02 and PA-C03. It does not authorize live execution.

Meridian remains **non-custodial**. `POST /api/v1/executions` is an audited **501** until the
compliance gate in `docs/COMPLIANCE.md` is satisfied. These gates do not weaken that restriction.

A process is **production-locked** when `NODE_ENV=production` **or** `PLATFORM_MODE=production`.

---

## 1. Production configuration requirements

| Variable | Development | Test | Staging / production-locked |
| -------- | ----------- | ---- | --------------------------- |
| `NODE_ENV` | `development` (default) | `test` | `production` |
| `PLATFORM_MODE` | `sandbox` (default) | `sandbox` | `production` |
| `DATABASE_DRIVER` | `memory` allowed | `memory` allowed | `postgres` required |
| `DATABASE_URL` | optional | optional | required |
| `AUTH_SECRET` | optional | optional | required, ≥32 characters, not a demo/default secret |
| `SEED_DEMO_TENANTS` | auto-seed without this flag | `true` only for Playwright | must be `false`; `true` is rejected |
| `PRODUCTION_ROUTING_AVAILABLE` | must be `false` | must be `false` | default `false`; `true` only with licensed adapters |
| `PRODUCTION_EXECUTION_AVAILABLE` | `false` | `false` | `false`; `true` is always a startup failure |

`loadConfig` is the single validation entry. A bad combination throws `ConfigurationError` at
startup. The process does not rewrite the environment, swap drivers, or invent secrets.

Independent flags on the loaded config (also published on `GET /api/v1/meta` as `productionGates`):

- `PRODUCTION_ROUTING_AVAILABLE` — licensed partner quotes may be offered.
- `PRODUCTION_EXECUTION_AVAILABLE` — partner execution may be offered. **Always false** in this
  tree. Setting the env var to `true` fails closed so a production environment cannot pretend
  execution exists.

`AUTH_SECRET` is never copied onto `AppConfig`. Only `authSecretConfigured: true | false` is
retained. Logs redact `*.AUTH_SECRET` / `*.authSecret`.

---

## 2. Provider requirements

`PLATFORM_MODE=production`:

- Demo / sandbox adapters are never registered.
- `createFinancialCatalog(..., { includeDemoAdapters: false })` — Helios ramp and the three DeFi
  demo adapters are not attached.
- The route graph is empty (`FinancialRouteGraph.create([], [])`). Demo venues are not presented
  as live venues.
- No fake licensed provider is created.

Routing enablement:

- `PRODUCTION_ROUTING_AVAILABLE=false` (default): the API may start **read-only**. The comparison
  registry is empty (`ProviderRegistry.create(..., { allowEmpty: true })`). Quotes from licensed
  partners are not offered because none are configured. Meta reports `routingAvailable: false`.
- `PRODUCTION_ROUTING_AVAILABLE=true`: startup **fails** unless at least one `licensed_partner`
  adapter is registered. This repository has **zero** licensed adapters, so the flag fails closed.
  Do not invent a stub partner to make the flag pass.

`ProviderRegistry` still excludes `unlicensed_sandbox` adapters in production and still refuses a
non-empty production registry that has no `licensed_partner` member.

---

## 3. Secret requirements

When production-locked:

- Demo tenant provisioning is forbidden (`shouldProvisionDemoTenants` is false;
  `provisionDemoTenants({ productionLocked: true })` throws).
- `prisma/seed.ts` refuses to run.
- `AUTH_SECRET` must be set in the environment, at least 32 characters, and must not equal a
  documented demo password, the documented demo agent secret, or a well-known default fallback.
- Login rejects documented demo emails and demo passwords with the **same generic 401** as any
  other failed login (no account enumeration).
- Presented `mag_` secrets that match the documented demo agent secret are rejected.

Do not hardcode a replacement secret. Operators supply `AUTH_SECRET` via the environment.

Development and test may continue to use the documented sandbox credentials:

- email `treasury@demo-trading.example.invalid`
- password `MeridianDemo!2026`
- agent secret `mag_demo_agent01_sandbox_only_not_production`

Those values are sandbox fixtures, not production secrets.

---

## 4. Database requirements

When production-locked:

- `DATABASE_DRIVER=memory` **fails closed**.
- The only approved persistent production database is **PostgreSQL** (`DATABASE_DRIVER=postgres`).
- `DATABASE_URL` is required.
- The process does **not** silently switch to postgres, and does **not** silently fall back to
  memory.

Development and the default unit/integration suite may use `DATABASE_DRIVER=memory`. Playwright e2e
uses memory by design (`NODE_ENV=test`, `PLATFORM_MODE=sandbox`).

---

## 5. Demo-mode restrictions

| Action | Sandbox development | Test | Production-locked |
| ------ | ------------------- | ---- | ----------------- |
| Load sandbox pricing adapters | yes | yes | no |
| Attach demo ramp / DeFi catalog adapters | yes | yes | no |
| Load demo route graph | yes | yes | no |
| Auto-provision demo tenants | yes | only `SEED_DEMO_TENANTS=true` | no |
| Accept demo password / demo agent secret | yes | yes | no |
| Show demo credentials on the login page | when API `mode=sandbox` | when API `mode=sandbox` | no |
| Run `npm run db:seed` | allowed against a scratch DB | allowed against `TEST_DATABASE_URL` | refused |

---

## 6. Execution restrictions

Unchanged, and independently false from routing:

- `POST /api/v1/executions` audits the attempt and returns **501**.
- `PRODUCTION_EXECUTION_AVAILABLE` cannot be set true.
- Meta `execution.implemented` is false; `execution.statusCode` is 501.
- Meta `productionGates.executionAvailable` is false.
- The sandbox simulator (`POST .../payment-intents/:id/simulate`) is disabled when
  production-locked (same 501). It remains available in sandbox.
- Capability flags `executeTransactions`, `delegateExecution`, `custodyFunds`, `holdPrivateKeys`,
  `controlCustomerWallets`, `operateAsPrincipal`, `defiExecution` remain false.

A production deployment with no licensed execution partner must never report that execution is
available.

---

## Operator checklist (quoting, still non-custodial)

1. `NODE_ENV=production`
2. `PLATFORM_MODE=production`
3. `DATABASE_DRIVER=postgres` and a migrated `DATABASE_URL`
4. `AUTH_SECRET` set (unique, ≥32 characters, not a demo/default value)
5. `PRODUCTION_ROUTING_AVAILABLE=false` until a real licensed adapter is registered
6. `PRODUCTION_EXECUTION_AVAILABLE=false`
7. `SEED_DEMO_TENANTS` unset or false
8. Confirm `GET /api/v1/meta` → `productionGates.routingAvailable === false`,
   `productionGates.executionAvailable === false`, `execution.statusCode === 501`

Do not enable delegated execution from this document.
