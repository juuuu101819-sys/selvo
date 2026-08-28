# Stack and Project Initialization

This document records the chosen stack, where each initialization requirement is satisfied, and the
decisions that were not obvious.

## Repository state at the time of initialization

The repository was **not empty**. It already held a working monorepo with 272 passing tests from the
route-comparison MVP. Nothing was re-scaffolded; the work was to close the genuine gaps against the
target stack. What was added or changed is marked below.

## Stack

| Layer                    | Choice                                            | Notes                                                                                 |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Frontend                 | Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui | App Router, component-based, server actions for API calls.                            |
| Backend                  | Fastify 5 in `apps/api`                           | A clearly separated backend module rather than Next.js route handlers — see below.    |
| API style                | REST, versioned at `/api/v1`                      | **Changed:** was `/v1`, which remains as a deprecated alias.                          |
| Database                 | PostgreSQL                                        | Driver selected by configuration; in-memory is the default for development and tests. |
| ORM                      | Prisma 7                                          | **Added.** Schema and migrations at `/prisma`, client behind the persistence ports.   |
| Validation               | Zod 4                                             | Request schemas, environment schema, pricing dataset schema.                          |
| Unit / integration tests | Vitest 3                                          | Domain unit tests and in-process Fastify integration tests.                           |
| End-to-end tests         | Playwright                                        | **Added.** API contract, browser journey and mobile layout projects.                  |
| Authentication           | Sessions + API keys                               | Organization-scoped. No SSO. Passwords hashed with scrypt.                            |

## Directory structure

The brief suggested a single-application layout (`/app`, `/components`, `/lib`, `/server`, …). This
repository is a monorepo, so the equivalent is:

| Suggested     | Here                                             | Why                                                                                                                    |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `/app`        | `apps/web/src/app`                               | Next.js App Router.                                                                                                    |
| `/components` | `apps/web/src/components`                        | UI components; `components/ui` holds shadcn/ui primitives.                                                             |
| `/lib`        | `apps/web/src/lib`, `packages/*`                 | Client-side helpers in the web app; domain logic in packages.                                                          |
| `/server`     | `apps/api`                                       | The backend module, deployable independently of the web app.                                                           |
| `/prisma`     | `/prisma`                                        | Schema and migrations at the root: migrations are a deployment-level concern.                                          |
| `/types`      | `packages/core`, `apps/web/src/lib/api/types.ts` | Domain types in core; the wire contract restated in the web app (see below).                                           |
| `/tests`      | `/tests/e2e`                                     | End-to-end tests span both apps, so they sit above either. Unit and integration tests live beside the code they cover. |
| `/docs`       | `/docs`                                          | Unchanged.                                                                                                             |

## Decisions worth recording

### Fastify rather than Next.js route handlers

The brief allowed either. A separate backend module was chosen because the API is the product's
integration surface: business customers will call it directly, and it needs to scale and deploy
independently of a rendering tier. It also keeps the financial engine reachable without a React
runtime in the process, which is what makes the domain testable in isolation.

### Prisma as ORM, with the driver adapter

Prisma owns the schema and migrations. The client is used only inside `packages/persistence`, behind
the `ComparisonRepository` and `AuditLogRepository` ports, so nothing above the persistence layer
imports Prisma and the store stays replaceable.

Three details were not obvious:

- **Generator choice.** `prisma-client-js` is used rather than the newer `prisma-client`. The newer
  generator emits TypeScript that imports with explicit `.ts` extensions, which a NodeNext package
  compiling to `dist/` cannot consume without disabling its own emit, and whose output would have to
  be imported by relative path from outside the package's `rootDir`. The older generator emits
  JavaScript plus declarations, re-exported through `@prisma/client`, so the import is an ordinary
  package specifier.
- **Decimal, never number.** `amount_minor_units` is `DECIMAL(38, 0)`. The repository converts with
  `toFixed(0)` and never `toNumber()`: a large VND or IDR notional in minor units exceeds
  `Number.MAX_SAFE_INTEGER`, and a unit test demonstrates the digits that would be lost.
- **Constraints Prisma cannot express.** The CHECK constraints and the append-only audit trigger are
  hand-added to the generated migration. Because that is exactly the kind of edit a future
  `migrate diff` could silently drop, a test asserts they are still present.

### `/api/v1` with a deprecated alias

The canonical prefix is `/api/v1`. The original `/v1` mount still serves the same routes and returns
`Deprecation: true` with a `Link` to its successor. One plugin is registered twice, so there is no
duplicated implementation. A versioned API is only worth having if retiring a version is routine, so
the alias exists for one version and then goes.

Liveness and readiness (`/health`, `/ready`) are deliberately unversioned and unauthenticated: an
orchestrator should not have to track API versions, and a probe must not start failing because a
proxy attached a credential the service cannot verify.

`GET /api/v1/health` returns a fixed three-field contract with no envelope and nothing derived from
runtime state. A health check that changes shape as the service evolves eventually breaks the monitor
watching it.

### The web app restates the wire contract

`apps/web/src/lib/api/types.ts` duplicates the API's DTO shapes rather than importing them from
`@meridian/core`. The web app is a separate deployable that talks HTTP; depending on the published
contract rather than the server's internals is what lets the two be versioned and released apart. The
API's own integration tests are what hold the contract to its documented shape.

### Authentication is organization-scoped

A credential becomes a `Principal` once per request, before any handler. Dashboard queries take
`organizationId` from that principal and apply it in the store. The web app keeps the session token
in an httpOnly cookie and sends `Authorization: Bearer` to the API — the two ports do not share
cookies.

- `Principal` carries `organizationId`, `subjectId`, `roles` and a `verified` flag.
- Session tokens (`mds_…`) are stored as HMAC-SHA-256 digests (pepper derived from `AUTH_SECRET`) with a 12-hour TTL. Passwords and API keys / agent secrets use tagged scrypt hashes. Legacy unsalted SHA-256 hashes are re-hashed on first use until 2026-11-28.
- API keys are looked up by a 16-character prefix; only the hash of the secret is stored.
- Public comparison remains anonymous. A credential that cannot be verified is still a `401`.

Deliberately absent: SSO, SAML, SCIM, MFA and federated identity.

## Known advisory

`npm audit` reports three high-severity findings, all the same root cause: `deepmerge-ts` reached
through `@prisma/config`, which Prisma 7 makes a dependency of `@prisma/client`. The only offered fix
downgrades to Prisma 6.12, losing the config-based datasource design this setup is built on.

The advisory is stack exhaustion when merging recursive object graphs. It is reachable through Prisma
config loading, which happens at CLI time over this repository's own `prisma.config.ts` — not over
any request-controlled input. It is therefore not exploitable through the running service, and the
finding is accepted rather than fixed by downgrade. Re-evaluate when Prisma releases a patched
`@prisma/config`.

## Commands

```bash
npm install            # also runs prisma generate via postinstall
npm run dev            # API on :47311, web on :43117

npm run verify         # lint, typecheck, unit and integration tests
npm run test:e2e       # Playwright: API contract, browser journey, mobile layout

npm run db:validate    # validate the Prisma schema
npm run db:generate    # regenerate the client
npm run db:migrate     # create and apply a migration (needs DATABASE_URL)
npm run db:deploy      # apply pending migrations (needs DATABASE_URL)
```
