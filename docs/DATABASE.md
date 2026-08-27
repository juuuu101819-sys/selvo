# Meridian — Database

PostgreSQL, with Prisma owning the schema and the migrations. The generated client is used only
inside `packages/persistence`, behind the `ComparisonRepository` and `AuditLogRepository` ports, so
nothing above the persistence layer imports Prisma.

Crypto and stablecoin *tickers* (`USDC`, `ETH`) are not rows in `currencies`. That table is ISO 4217
(`VARCHAR(3)`). Multi-rail assets live in `ASSET_REGISTRY` in core; Phase 8 did not migrate the
schema.

Schema: [`prisma/schema.prisma`](../prisma/schema.prisma).
Migrations: [`prisma/migrations`](../prisma/migrations).
Seed: [`prisma/seed.ts`](../prisma/seed.ts).

---

## The non-custody boundary, in the schema

The MVP does not custody customer funds, and the data model is built so that it _cannot_ record a
settlement:

- **`TransactionRequest` is a request, not a transfer.** `TransactionRequestStatus` is a PostgreSQL
  enum with exactly five values — `draft`, `quoted`, `quotes_expired`, `quote_selected`,
  `cancelled`. There is no `settled`, `executed`, `funded`, `in_flight` or `paid`. Recording a
  settlement would require altering an enum type in a migration, which is the review friction it
  should have. An integration test reads `pg_enum` and asserts the forbidden values are absent.
- **`quote_selected` means the customer said which quote they intend to use.** It is not an
  instruction, nothing moves, and `selectedAt` records only when they said it.
- **No balances, no wallets, no ledger.** There is no table capable of representing customer funds
  held by the platform. `QuoteLeg.counterparty` names who performs each hop, and it is never
  Meridian — asserted by a test.
- **No provider credentials.** `Provider.metadata` holds a docs URL and a support contact. Secrets
  are resolved from the environment through the `SecretResolver` port. A test asserts the
  `providers` table has no credential-shaped column, and that seeded metadata contains no secret.
- **API keys store only a hash.** `ApiKey.secretHash`; the secret is shown once on issue and never
  persisted.

## Money in the database

| Concern          | Type                                   | Why                                                                                                                                 |
| ---------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Monetary amounts | `DECIMAL(38, 0)` counts of minor units | Exact integers. A KRW or IDR notional in minor units passes `Number.MAX_SAFE_INTEGER`, so a `BIGINT` is tight and a float is wrong. |
| Exchange rates   | `DECIMAL(38, 18)`                      | Covers USD/VND at ~25,000 alongside an 18-decimal rate without losing the tail.                                                     |
| Basis points     | `DECIMAL(12, 4)`                       | Spread, slippage and cost, to four decimal places.                                                                                  |
| Reliability      | `DECIMAL(5, 4)`                        | A `0..1` score.                                                                                                                     |

`REAL`, `DOUBLE PRECISION`, `FLOAT` and `MONEY` appear nowhere. A test greps the migrations for them.

Reading a `Decimal` **always** goes through `.toFixed(0)`, never `.toNumber()`. There is a test that
demonstrates the digits `toNumber()` drops for `2^53 + 1`, so the reason is recorded rather than
assumed.

### Field-name mapping

The brief names the financial fields conceptually; the schema names them with their unit, because
that is what prevents the class of bug the platform exists to avoid.

| Brief                    | Column                                     | Notes                                                                                               |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `amount`                 | `amount_minor_units`                       | Minor units of `source_currency`.                                                                   |
| `currency`               | `source_currency`, `target_currency`       | Both sides, as `VARCHAR(3)` FKs to `currencies`.                                                    |
| `fee`                    | `total_fee_minor_units` + `fees` rows      | The total, plus the itemised components.                                                            |
| `exchangeRate`           | `exchange_rate`                            | The rate offered. `mid_market_rate` is the benchmark; `effective_rate` is the realised all-in rate. |
| `spread`                 | `spread_bps`                               | Basis points over mid-market.                                                                       |
| `slippage`               | `slippage_bps`                             | Expected execution slippage at this notional.                                                       |
| `totalCost`              | `total_cost_minor_units`, `total_cost_bps` | All-in cost against the mid-market benchmark.                                                       |
| `estimatedReceiveAmount` | `estimated_receive_minor_units`            | With `benchmark_receive_minor_units` alongside, so the cost figure is explainable.                  |

## Model map

```
Currency ──┬── ProviderCapability ── Provider ──┬── Route ── Quote
           ├── Route                            ├── Quote
           ├── TransactionRequest               └── CustomerPricing
           ├── Quote / QuoteLeg / Fee
           └── CustomerPricing

Organization ──┬── OrganizationMember ── User
               ├── ApiKey
               ├── TransactionRequest ──┬── Quote ──┬── QuoteLeg
               │                        │           └── Fee
               │                        └── Comparison
               ├── CustomerPricing
               ├── Comparison
               ├── ExecutionIntent
               ├── Agent ── AgentCredential / AgentWalletReference / PaymentPolicy / PaymentIntent
               ├── Merchant
               └── AuditLog
```

### Reference data

**`Currency`** — ISO 4217 data: code, numeric code, name, minor-unit `exponent`, `kind`
(`fiat`/`stablecoin`), `isActive`.

This table governs which currencies the platform _offers_. It is **not** the source of truth for
arithmetic — `CURRENCY_REGISTRY` in `packages/core` is, because the money model needs an exponent
synchronously and offline, with no database round trip on the money path. Two sources for one fact is
a genuine risk, so the seed refuses to write a fiat exponent that disagrees with the code, and an
integration test asserts they still agree.

The exponent CHECK constraint depends on `kind`: fiat is bounded at 4 (ISO 4217 tops out there, with
CLF), stablecoins at 18, because USDC-style assets carry 6. A single loose bound would have permitted
a nonsense fiat exponent.

Stablecoin rows exist so a quote's legs can name what the money passes through. They are not offered
as corridor currencies: `CURRENCY_REGISTRY`, which governs what the API will price, is fiat only.

### Tenancy

**`Organization`** — the tenant boundary every query is scoped by.

**`User`** — a person. `passwordHash` is a tagged scrypt hash (the schema comment names Argon2id as
the intended production KDF; scrypt needs no native addon, so local development stays installable).
Plaintext is never stored, logged or selected into a DTO.

**`OrganizationMember`** — membership with a role (`owner`/`admin`/`member`/`viewer`). Membership is
its own record rather than a column on `User`, so one person can act for several businesses — a group
treasury function or an external accountant, both normal in this market and painful to retrofit.

**`ApiKey`** — machine credential, hash only. Lookups go by `keyPrefix`; the secret is compared as a
SHA-256 hash with a timing-safe check. `scopes` is a subset of `quote:read`, `route:read`,
`transaction:create`. `expiresAt` and `revokedAt` are optional. The prefix is the only form returned
to the dashboard; the raw secret is shown once on issue.

**`Session`** — a hashed session token (`mds_…`) bound to one user and one organization, with an
expiry. Logout sets `revokedAt`. Raw tokens are never stored.

**`ExecutionIntent`** — a recorded route choice. `status` is always `recorded`. `executable` and
`submitted` are always false (CHECK constraints). Amounts are `DECIMAL(38,0)` minor units of the
source asset ticker (`VARCHAR(16)`), not an ISO currency FK. No wallet, key or settlement columns.

### Providers

**`Provider`** — the _operational_ registry: who exists, what they are licensed for, whether they are
enabled. `modes` gates a provider to `sandbox` or `production`, and `licensing` records their posture,
so sandbox pricing can never reach a production caller.

`adapterId` links a provider row to the `RouteProvider` adapter in `packages/adapters` that actually
prices it. That link is what stops the registry and the integrations drifting into two independent
lists of providers: the seed fails loudly if an adapter has no row.

**`ProviderCapability`** — what a provider can do on one corridor: notional bounds, indicative
spread, slippage, settlement percentiles, cut-off, intermediary asset. Separate from `Provider`
because coverage is per-corridor and changes far more often — a bank adding KRW payout is a
capability change, not a new provider.

### Routes, requests and quotes

**`Route`** — one provider, one rail, one corridor, with a `legTemplate` describing the shape of its
quotes. A `Quote` is a price _for_ a route; separating them means the catalogue of what is possible is
queryable without reading through priced quotes, and a route outlives the expiry of every quote
against it.

**`TransactionRequest`** — what a customer asked to have priced. See the non-custody notes above.

**`Quote`** — one provider's price for one request, with `quotedAt` and a **required** `expiresAt`
(a quote without an expiry is a liability). Every figure is derived by the routing engine from the
provider's primitives, so a quote can always be explained: `exchange_rate` against `mid_market_rate`
gives the spread, `total_cost_minor_units` against `benchmark_receive_minor_units` gives the all-in
cost, and the `Fee` and `QuoteLeg` rows account for the rest.

**`QuoteLeg`** — one hop. A bank wire is a single `fx_conversion`; a stablecoin route is three —
`fiat_onramp`, `stablecoin_transfer`, `fiat_offramp`. Modelling the hops is what lets the UI show a
customer where their money actually goes, and name the counterparty on each.

**`Fee`** — one fee component, resolved to an amount. Stored per component rather than as a single
total so a customer can argue with the individual charge rather than a headline percentage.
`chargedBy` is kept distinct from `side`, so a platform markup is never mistaken for a provider
charge in a dispute.

### Commercial terms

**`CustomerPricing`** — overlapping rules resolved by `priority`, not one rate per customer, because
real B2B pricing is negotiated per corridor and per rail. `effectiveFrom`/`effectiveTo` make a
repricing an insert rather than an update, so a historical quote can always be explained by the terms
that applied when it was issued. `Quote.customerPricingId` records which row applied.

### Reproducibility and audit

**`Comparison`** — the immutable, replayable record: the snapshot the engine needs to recompute a
comparison, plus its SHA-256 fingerprint.

The normalised `Quote` rows are the _queryable projection_ of a comparison; `Comparison` is what makes
it _reproducible_. Keeping both is deliberate — a future schema change to `Quote` must never be able
to alter what a customer was quoted last quarter.

**`AuditLog`** — append-only. A trigger rejects `UPDATE` and `DELETE`, and the repository exposes
neither. Integration tests prove both: an insert succeeds, and a direct SQL `UPDATE` and `DELETE`
both raise.

## Invariants enforced by the database

Prisma cannot express a CHECK constraint, a partial unique index or a trigger, so these are
hand-added to the generated migration. That makes them exactly the kind of edit a future
`prisma migrate diff` could quietly drop, so they are asserted twice: as SQL text in a unit test that
runs anywhere, and by execution against a real server in the integration suite.

| Invariant                                                        | Enforcement                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A currency exponent is plausible for its kind                    | `currencies_exponent_range`                                                  |
| Capability bounds are orderable, p95 ≥ p50, spreads non-negative | `capability_*`                                                               |
| A request is a cross-currency corridor for a positive amount     | `request_amount_positive`, `request_corridor_differs`                        |
| Rates are positive; a quote cannot expire before it was issued   | `quote_rates_positive`, `quote_expiry_after_quoted`                          |
| Payouts and fees are non-negative; a score is 0–100              | `quote_receive_non_negative`, `quote_fees_non_negative`, `quote_score_range` |
| Legs are ordered from 1 and move non-negative amounts            | `leg_sequence_positive`, `leg_amounts_non_negative`                          |
| A fee is a charge, never a rebate                                | `fee_amount_non_negative`                                                    |
| Commercial terms are non-negative over a valid period            | `pricing_non_negative`, `pricing_period_valid`                               |
| At most one recommended quote per request                        | partial unique index `quotes_one_recommendation_per_request`                 |
| The audit trail is immutable                                     | trigger `audit_logs_no_mutation`                                             |
| API key scopes are the known three values                        | `api_keys_scopes_known`                                                      |
| An execution intent is recorded, never executable or submitted   | `execution_intents_status_recorded`, `execution_intents_not_executable`, `execution_intents_not_submitted` |

## Working with the database locally

No database is needed for development or for the default test suite: `DATABASE_DRIVER=memory` is the
default, and the 31 database tests skip when `TEST_DATABASE_URL` is unset.

```bash
# One-off: a local server, a role and two databases.
sudo apt-get install -y postgresql
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "CREATE ROLE meridian LOGIN PASSWORD 'meridian' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE meridian OWNER meridian;"
sudo -u postgres psql -c "CREATE DATABASE meridian_test OWNER meridian;"

export DATABASE_URL="postgresql://meridian:meridian@127.0.0.1:5432/meridian"

npm run db:validate     # validate the schema
npm run db:generate     # regenerate the client (also runs on postinstall)
npm run db:deploy       # apply prisma/migrations
npm run db:seed         # load demo data
npm run db:studio       # browse it

# Point the API at PostgreSQL instead of memory.
DATABASE_DRIVER=postgres npm run dev:api
```

Database tests are gated on `TEST_DATABASE_URL` rather than `DATABASE_URL`, deliberately: they write
and delete rows, so requiring a separately named variable means nobody can run them against a real
database just because the usual one is exported in their shell.

```bash
export TEST_DATABASE_URL="postgresql://meridian:meridian@127.0.0.1:5432/meridian_test"
npm run db:deploy && npm run db:seed   # with DATABASE_URL pointing at meridian_test
npm test
```

## Migrations

`prisma/migrations/20260826120000_init` is a single squashed initial migration. The schema had not
been deployed anywhere when the domain model landed, so squashing was preferable to shipping a rename
migration for tables no database had. From here on, migrations are additive and generated with
`npm run db:migrate`.

When a migration is generated, any CHECK constraint, partial index or trigger it needs must be
appended by hand, and the assertions in `prisma-driver.test.ts` extended to cover it.

## Seed data

`npm run db:seed` is idempotent — it upserts, so it can be re-run.

Because the seed runs the real routing engine, it imports the workspace packages' compiled output.
`npm run db:seed` and `npm run db:reset` build first; Prisma does not pass its seed command through a
shell, so the build cannot be chained inside `prisma.config.ts`. Invoking `prisma db seed` directly on
an unbuilt clone fails to resolve `@meridian/*`, and the fix is to run `npm run build`.

It loads: 7 fiat currencies (USD, KRW, EUR, JPY, SGD, HKD, GBP) plus one demo stablecoin for
intermediary legs; 4 demo providers with 156 corridor capabilities and 156 routes; a demo
organization with an owner; 3 overlapping customer pricing rules; and one priced demo transaction
request.

Two rules shape the seed:

- **No live secrets.** Provider hostnames are `example.invalid`. The demo user password is the
  documented sandbox credential, stored only as a scrypt hash.
- **No hardcoded prices.** The demo quotes are not invented figures. The seed runs the real routing
  engine over the real sandbox adapters and persists what comes back, so the demo data stays honest
  as pricing evolves — and a schema that could not represent a real quote fails at seed time rather
  than in production.

The current seed produces, for USD 100,000 → KRW:

| Provider                 | Rail                  | All-in cost | Settlement     |
| ------------------------ | --------------------- | ----------- | -------------- |
| Demo Stablecoin Provider | stablecoin_settlement | 33.96 bps   | 5 min          |
| Demo Liquidity Provider  | liquidity_provider    | 37.99 bps   | 30 min         |
| Demo FX Provider         | payment_institution   | 47.76 bps   | 2 hours        |
| Demo Bank FX             | bank_fx               | 71.84 bps   | 1 business day |

## Not yet wired

The routing engine still prices from the file-based sandbox adapters, not from `Provider` and
`ProviderCapability`. The dashboard reads `TransactionRequest` and `Quote` rows scoped by
`organizationId`. Live HTTP comparisons still persist `Comparison` snapshots; attaching those writes
to the quote tables on every request is later work. The seed already exercises the full model end to
end, which is what proves the schema can hold real engine output.
