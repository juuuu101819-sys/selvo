# Meridian

**Find the best financial route for a business transaction.**

Meridian is a B2B global financial routing platform. Give it a corridor and an amount and it prices
every available route — traditional bank FX, licensed payment institutions, regulated stablecoin
settlement, wholesale liquidity providers — and reports the all-in cost, exchange rate, fee
breakdown, settlement time, expected slippage and a composite route score for each.

```
USD 100,000 → KRW

  1  Solstice Settlement   Stablecoin partner    0.34%   settles in 5 min        ← recommended
  2  Aperture Liquidity    Liquidity provider    0.38%   settles in 30 min
  3  Veridian Payments     FX provider           0.48%   settles in 2 hours
  4  Northgate Bank        Bank FX               0.72%   settles in 1 business day
```

Cost is measured against the **mid-market benchmark**, not against each provider's own rate. That is
the only way a bank quoting "no fees" on a 69 bps spread can be compared honestly against a payment
institution charging an explicit fee on a keen rate.

## What Meridian does not do

Meridian is a decision-support system. It **does not** custody customer funds, execute
transactions, hold crypto assets, issue stablecoins, or provide regulated financial services
without a licensed partner. These are enforced in code, not just documented — see
[docs/COMPLIANCE.md](./docs/COMPLIANCE.md). `POST /v1/executions` returns a deliberate, audited
`501`.

## Running it locally

Requires Node.js 20.11 or newer. No database or Docker needed: the default persistence driver is
in-memory and the sandbox rails are priced from data files in the repository.

```bash
npm install              # also generates the Prisma client via postinstall
cp .env.example .env     # optional; every value has a working default
npm run dev              # API on :47311, web app on :43117
```

Then open <http://127.0.0.1:43117>.

To run just one side:

```bash
npm run dev:api
npm run dev:web
```

A quick check against the API directly:

```bash
curl -s http://127.0.0.1:47311/api/v1/health
# {"status":"ok","service":"financial-router","version":"1.0.0"}

curl -s -X POST http://127.0.0.1:47311/api/v1/comparisons \
  -H 'content-type: application/json' \
  -d '{"sourceCurrency":"USD","targetCurrency":"KRW","amount":"100000.00"}' | jq '.data.routes[] | {rank, provider: .provider.name, cost: .totalCostPercent}'
```

## Verifying a change

```bash
npm run verify       # lint, typecheck, unit and integration tests
npm run test:e2e     # Playwright: API contract, browser journey, mobile layout

npm run lint
npm run typecheck
npm test
```

Roughly 300 Vitest tests — unit tests over the financial calculations, a provider conformance check
every adapter must pass, and integration tests exercising the real Fastify app in-process — plus 19
Playwright tests that drive the built app over real HTTP.

## Repository layout

```
apps/
  api/            HTTP boundary. Fastify + Zod. Validation, error mapping, wiring.
  web/            Next.js UI. Renders comparisons; holds no financial logic. The results page
                  leads with the best route, then alternatives, then a cost comparison; quote
                  expiry is a live countdown with a refresh once a price lapses; and the only
                  forward action is "Continue with partner" — nothing implies execution.
packages/
  core/           Pure domain: money, cost engine, scorer, ports, errors. No I/O.
  adapters/       RouteProvider implementations. Sandbox rails today, partners later.
  persistence/    Repository implementations: in-memory and PostgreSQL via Prisma.
prisma/
  schema.prisma   The domain model: tenancy, providers, routes, requests, quotes, audit.
  migrations/     Generated SQL, plus the constraints and triggers Prisma cannot express.
  seed.ts         Demo data, priced by running the real engine rather than by fixtures.
tests/
  e2e/            Playwright specs spanning both apps.
docs/
  ARCHITECTURE.md How it fits together and why.
  QUOTE_ENGINE.md The pricing and scoring mathematics, stated formally.
  PROVIDERS.md    Market data and provider interfaces, resilience, quote freshness.
  DATABASE.md     The data model, its invariants, and how to work with it locally.
  STACK.md        The chosen stack, the directory mapping, and the decisions behind them.
  ROADMAP.md      Phase plan. Phase 1 is what exists.
  COMPLIANCE.md   The boundaries, and how the code enforces them.
  API.md          Endpoint reference.
```

The dependency graph points inward: `core` depends on nothing but `decimal.js`, which is what makes
the financial logic testable without a server, a database or a network.

## Authentication

Phase 1 has no authentication, and says so rather than implying otherwise. A request presenting an
`Authorization` or `X-Api-Key` header is rejected with `401` instead of being quietly served as
anonymous — a client that sent a token and got a `200` back would reasonably assume it was
authenticated and scoped to its organization, when neither is true.

What is prepared is the architecture, because that is the part that is hard to retrofit: an
`Authenticator` port resolving a credential to a `Principal` once per request, a tenant boundary
(`organizationId`) on that principal, audit events attributed from it rather than from a header read
at the call site, and `Organization` / `User` / `ApiKey` tables in the schema. SSO, SAML, SCIM and MFA
are explicitly out of scope. See [docs/STACK.md](./docs/STACK.md).

## Notes on the numbers

- Monetary amounts are `bigint` counts of a currency's minor units, with the exponent taken from an
  ISO 4217 registry (`USD` → 2, `KRW` → 0, `KWD` → 3). Rates and ratios are `decimal.js` values at
  34 significant digits. No `number` arithmetic happens anywhere on the money path, and every
  rounding site names its mode.
- Providers return pricing _primitives_ — mid rate, offered rate, fee schedule, settlement estimate,
  slippage parameters — never a computed cost. One engine derives cost for every route, so a
  provider cannot define its own notion of "cheap".
- Every quote carries a timestamp and a provider id. Every comparison persists a snapshot and a
  SHA-256 fingerprint, and `POST /v1/comparisons/:id/replay` re-derives it to prove the calculation
  reproduces.
- Sandbox pricing lives in `packages/adapters/data/`, versioned and validated on load. Point
  `MERIDIAN_PRICING_DATA_DIR` elsewhere to swap the dataset without touching code.
- In the database, amounts are `DECIMAL(38, 0)` and are read with `toFixed(0)`, never `toNumber()`: a
  large VND or IDR notional in minor units exceeds `Number.MAX_SAFE_INTEGER`.

## Configuration

Every setting comes from the environment and is validated once at startup, so a misconfigured
deployment fails immediately rather than surfacing as a strange 500. No secret is ever read from
source. See [.env.example](./.env.example) for the full list; the ones that matter most:

| Variable          | Default                  | Notes                                                               |
| ----------------- | ------------------------ | ------------------------------------------------------------------- |
| `PLATFORM_MODE`   | `sandbox`                | `production` requires a licensed partner adapter, or startup fails. |
| `DATABASE_DRIVER` | `memory`                 | `postgres` requires `DATABASE_URL` and the migration applied.       |
| `API_PORT`        | `47311`                  |                                                                     |
| `WEB_PORT`        | `43117`                  |                                                                     |
| `API_BASE_URL`    | `http://127.0.0.1:47311` | Where the web app's server-side calls go.                           |

To use PostgreSQL, set `DATABASE_URL`, run `npm run db:deploy` to apply `prisma/migrations`, then set
`DATABASE_DRIVER=postgres`. `GET /ready` fails loudly if the schema is missing.

Prisma owns the schema and migrations. Its client is used only inside `packages/persistence`, behind
the repository ports, so nothing above that layer imports Prisma:

```bash
npm run db:validate   # validate the schema
npm run db:generate   # regenerate the client (also runs on postinstall)
npm run db:deploy     # apply pending migrations
npm run db:migrate    # create and apply a new migration
npm run db:seed       # load demo data (idempotent)
npm run db:studio     # browse the data
```

The domain model — organizations, users, providers and their corridor capabilities, routes,
transaction requests, quotes with legs and itemised fees, customer pricing and the audit log — is
described in [docs/DATABASE.md](./docs/DATABASE.md), including how the schema itself makes recording
a settlement impossible.

## Status

The route comparison MVP and the data model are in place. Later phases — reading provider capability
from the database, persisting quotes through it, live licensed-partner adapters, corridor analytics,
and any execution work — are described in [docs/ROADMAP.md](./docs/ROADMAP.md) and are **not**
started. Execution in particular is gated on the checklist in
[docs/COMPLIANCE.md](./docs/COMPLIANCE.md).
