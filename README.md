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
npm install
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
curl -s -X POST http://127.0.0.1:47311/v1/comparisons \
  -H 'content-type: application/json' \
  -d '{"sourceCurrency":"USD","targetCurrency":"KRW","amount":"100000.00"}' | jq '.data.routes[] | {rank, provider: .provider.name, cost: .totalCostPercent}'
```

## Verifying a change

```bash
npm run verify       # lint, typecheck and the full test suite
npm run lint
npm run typecheck
npm test
```

265+ tests: unit tests over the financial calculations, a provider conformance check every adapter
must pass, and integration tests exercising the real Fastify app in-process.

## Repository layout

```
apps/
  api/            HTTP boundary. Fastify + Zod. Validation, error mapping, wiring.
  web/            Next.js UI. Renders comparisons; holds no financial logic.
packages/
  core/           Pure domain: money, cost engine, scorer, ports, errors. No I/O.
  adapters/       RouteProvider implementations. Sandbox rails today, partners later.
  persistence/    Repository implementations: in-memory and PostgreSQL.
docs/
  ARCHITECTURE.md How it fits together and why.
  ROADMAP.md      Phase plan. Phase 1 is what exists.
  COMPLIANCE.md   The boundaries, and how the code enforces them.
  API.md          Endpoint reference.
```

The dependency graph points inward: `core` depends on nothing but `decimal.js`, which is what makes
the financial logic testable without a server, a database or a network.

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

To use PostgreSQL, apply `packages/persistence/migrations/0001_init.sql`, then set
`DATABASE_DRIVER=postgres` and `DATABASE_URL`. `GET /ready` fails loudly if the schema is missing.

## Status

Phase 1 (route comparison MVP) is complete. Later phases — multi-tenancy, live licensed-partner
adapters, corridor analytics, and any execution work — are described in
[docs/ROADMAP.md](./docs/ROADMAP.md) and are **not** started. Execution in particular is gated on
the checklist in [docs/COMPLIANCE.md](./docs/COMPLIANCE.md).
