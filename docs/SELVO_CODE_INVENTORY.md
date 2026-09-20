# SELVO code inventory (Phase A)

Read-only inventory of the repository as it stands at commit `d5e27dd`, taken on 2026-09-18.
Every number here was measured against the working tree or a freshly migrated PostgreSQL database,
not estimated. Nothing outside this file was changed to produce it.

This document exists so that the SSOT reconciliation (Phases B–G) stands on verified facts rather
than on recalled context. Where a claim could not be verified, it is marked **UNVERIFIED** rather
than smoothed over.

---

## 1. Scope and method

| Property                 | Value                                                                           |
| ------------------------ | ------------------------------------------------------------------------------- |
| Commit inventoried       | `d5e27dd`                                                                       |
| Branch                   | `main` (clean, nothing unpushed at time of writing)                             |
| Total commits in history | 132                                                                             |
| First commit             | 2026-08-26                                                                      |
| Verification database    | PostgreSQL 16, schema built by `prisma migrate deploy` from `prisma/migrations` |

Counts came from `find`/`rg` over the working tree, from `pg_constraint` and
`information_schema` on a freshly migrated database, and from a full `vitest run` with a JSON
reporter. Route counts were parsed out of `apps/api/src/openapi/catalog.ts` rather than counted by
hand.

---

## 2. Workspace layout

npm workspaces monorepo, `packages/*` and `apps/*`. Node `>=20.11`, ESM throughout, TypeScript.

| Workspace              | Package name            | Source files | Test files | Role                                                   |
| ---------------------- | ----------------------- | ------------ | ---------- | ------------------------------------------------------ |
| `packages/core`        | `@meridian/core`        | 187          | 70         | Pure domain, engines, ports. No I/O.                   |
| `packages/adapters`    | `@meridian/adapters`    | 30           | 8          | Sandbox/demo providers, resilience, contract test kit. |
| `packages/persistence` | `@meridian/persistence` | 44           | 7          | In-memory and Prisma drivers behind the ports.         |
| `apps/api`             | `@meridian/api`         | 63           | 58         | Fastify HTTP boundary, config, wiring.                 |
| `apps/web`             | `@meridian/web`         | 107          | 13         | Next.js UI, 8 locales.                                 |

Non-test source across all five workspaces: **67,801 lines**.

Root-level files of record: `Dockerfile`, `docker-compose.staging.yml`, `GO_LIVE_CHECKLIST.md`,
`README.md`, `prisma/`, `.github/workflows/ci.yml`, `scripts/run-local-staging.sh`, `tests/e2e/`.

### 2.1 `packages/core` subdirectories

| Directory               | Non-test files |
| ----------------------- | -------------- |
| `engine`                | 57             |
| `domain`                | 40             |
| `ports`                 | 36             |
| `mandates`              | 11             |
| `graph`                 | 9              |
| `crypto`                | 6              |
| `money`                 | 6              |
| `auth`                  | 5              |
| `quotes`                | 4              |
| `reproducibility`       | 3              |
| `serialization`         | 3              |
| `pagination`, `testing` | 2 each         |
| `audit`, `errors`       | 1 each         |

---

## 3. API surface

117 routes are declared in the catalog: **34 public**, **83 authenticated**. All live under
`/api/v1` except `GET /health`, `GET /ready`, and `GET /openapi.json`.

| Group                                                                | Routes | Notes                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard`                                                          | 21     | Organization-scoped reads plus auth/policy/onboarding writes.                                                                                                                                                                                                                                |
| `ops`                                                                | 19     | Operator-only. Onboarding, billing, routing overrides, live enablement.                                                                                                                                                                                                                      |
| `auth`                                                               | 10     | Session, MFA, OIDC.                                                                                                                                                                                                                                                                          |
| `payment-intents`                                                    | 7      | Intent → quote → select → authorize → simulate.                                                                                                                                                                                                                                              |
| `settlement`                                                         | 6      | Generate-and-return instructions, verify, JWKS, semantics.                                                                                                                                                                                                                                   |
| `agents`                                                             | 5      | Agent lifecycle and wallet references.                                                                                                                                                                                                                                                       |
| `comparisons`                                                        | 5      | Public comparison surface with replay and audit.                                                                                                                                                                                                                                             |
| `api-keys`, `execution-intents`, `executions`, `mandates`, `routes`  | 3 each |                                                                                                                                                                                                                                                                                              |
| `agent`, `partner-instructions`, `providers`, `quote`, `route-graph` | 2 each |                                                                                                                                                                                                                                                                                              |
| 13 further groups                                                    | 1 each | `assets`, `audit`, `currencies`, `defi-liquidity`, `defi-routes`, `execution-partners`, `health`, `merchants`, `meta`, `onboarding`, `openapi.json`, `partner-webhooks`, `payment-policies`, `provider-quotes`, `receipts`, `reconciliation`, `simulate`, `stablecoin-routes`, `stablecoins` |

30 route modules under `apps/api/src/routes/`. `apps/api/src/routes/api-surface.test.ts` and
`apps/api/src/openapi/openapi.test.ts` hold the catalog and the registered router to each other, so
the catalog is a reliable proxy for the real surface.

### 3.1 Execution boundary routes

- `POST /api/v1/executions` — declared public, returns **501 `EXECUTION_NOT_IMPLEMENTED`**.
- `GET /api/v1/executions/:id` and `/receipt` — organization-scoped reads of sandbox orchestration.
- `POST /api/v1/settlement/instructions` — authenticated (`transaction:create`), generate-and-return.
- `POST /api/v1/partner-instructions` — authenticated, the Pattern C dispatch-shaped path, gated.

---

## 4. Database

45 Prisma models, 19 enums, **46 tables** after migration (45 models plus `_prisma_migrations`).
25 migrations, from `20260826120000_init` to `20260918100000_settlement_instructions`.

### 4.1 CHECK constraints by table

103 CHECK constraints across 28 tables. The concentration is where it should be:

| Table                                                                       | CHECKs |
| --------------------------------------------------------------------------- | ------ |
| `monetization_events`                                                       | 12     |
| `invoices`                                                                  | 11     |
| `quotes`                                                                    | 9      |
| `settlement_instructions`                                                   | 8      |
| `collection_attempts`, `payment_intents`                                    | 6 each |
| `execution_intents`, `provider_capabilities`                                | 5 each |
| `invoice_lines`                                                             | 4      |
| `comparisons`, `live_enablements`, `quote_legs`, `routing_manual_overrides` | 3 each |
| 7 tables                                                                    | 2 each |
| 8 tables                                                                    | 1 each |

### 4.2 The constraints that carry the non-custodial posture

These are the database-level facts the architecture rests on. Quoted verbatim from `pg_constraint`.

**Execution intents cannot become executable:**

```
execution_intents_not_executable   CHECK (executable = false)
execution_intents_not_submitted    CHECK (submitted = false)
execution_intents_status_recorded  CHECK (status = 'recorded')
```

**Orchestrated executions and receipts are sandbox-only and custody-free:**

```
orchestrated_executions_non_custodial
  CHECK (funds_moved = false AND custody = false AND transfer_signed = false
         AND meridian_keys_used = false AND sandbox = true)
execution_receipts_non_custodial
  CHECK (funds_moved = false AND custody = false AND meridian_keys_used = false AND sandbox = true)
```

**Realized revenue requires four independent facts, each its own constraint:**

```
monetization_events_realized_requires_production      CHECK (realized_revenue = false OR origin_env = 'PRODUCTION')
monetization_events_realized_requires_finality        CHECK (realized_revenue = false OR settlement_finality = 'provider_confirmed')
monetization_events_realized_revenue_collected_chk    CHECK ((realized_revenue = false AND revenue_recognition IN ('unrealized','invoiced'))
                                                          OR (realized_revenue = true  AND revenue_recognition = 'collected'))
monetization_events_realized_requires_collection_ref  CHECK (realized_revenue = false OR collection_reference IS NOT NULL)
```

Plus `funds_moved = false`, `custody = false`, `real_execution = false` on the same table.

**Settlement instructions cannot record a transmission:**

```
settlement_instructions_never_transmitted  CHECK (meridian_transmitted = false)
settlement_instructions_non_custodial      CHECK (funds_moved = false AND custody = false)
settlement_instructions_boundary_mode_known
  CHECK (boundary_mode IN ('RETURN_TO_CUSTOMER','PARTNER_EXECUTES'))
settlement_instructions_signed_material_present
  CHECK (length(payload_canonical) > 0 AND length(payload_hash) = 64
         AND length(signature) > 0 AND length(signing_key_id) > 0)
```

The table has **no** `status`, `dispatched_at`, `submitted_at`, or `partner_instruction_id` column —
verified by querying `information_schema.columns` for all six names and getting zero.

**Invoices are pinned pre-entity:**

```
invoices_issuer_unconfirmed  CHECK (issuer_legal_entity = 'unconfirmed')
invoices_tax_deferred        CHECK (tax_calculation = 'deferred')
invoices_tax_zero            CHECK (tax_minor_units = 0)
```

**Live enablement cannot be enabled without recorded sign-off:**

```
live_enablements_signoff_required
  CHECK (enabled = false OR (length(btrim(approved_by)) > 0
         AND length(btrim(license_basis)) > 0 AND length(btrim(checklist_ref)) > 0))
live_enablements_expiry_after_approval  CHECK (expires_at > approved_at)
live_enablements_scope_check            CHECK (scope IN ('corridor','partner','billing'))
```

**Drift note:** `live_enablements_scope_check` admits only three scopes, but
`LIVE_ENABLEMENT_SCOPES` in `packages/core/src/domain/live-enablement.ts:22` declares six
(`corridor`, `partner`, `billing`, `pricing_ad_valorem`, `pricing_gain_share`, `pricing_tpv`).
The three pricing scopes exist in the type system and in `GO_LIVE_CHECKLIST.md` but **cannot be
persisted** against this constraint. Since all three pricing flags default false and no row is
written today, this is latent rather than active — but it is a real code-vs-schema divergence and
belongs on the reconciliation ledger.

---

## 5. Configuration and gates

54 environment variables declared in `apps/api/src/config/env.ts`, validated once at startup.

### 5.1 The seven posture flags

| Flag                         | Default    | Helper          |
| ---------------------------- | ---------- | --------------- |
| `FLAT_TXN_PRICING_ENABLED`   | **`true`** | `booleanFlagOn` |
| `TIERED_TXN_PRICING_ENABLED` | `false`    | `booleanFlag`   |
| `AD_VALOREM_PRICING_ENABLED` | `false`    | `booleanFlag`   |
| `GAIN_SHARE_ENABLED`         | `false`    | `booleanFlag`   |
| `TPV_PRICING_ENABLED`        | `false`    | `booleanFlag`   |
| `BILLING_LIVE_ENABLED`       | `false`    | `booleanFlag`   |
| `PARTNER_LIVE_ENABLED`       | `false`    | `booleanFlag`   |

Adjacent, same discipline: `EXECUTION_ENABLED` `false`, `MANDATE_INGESTION_ENABLED` `false`,
`PRODUCTION_ROUTING_AVAILABLE` `false`, `PRODUCTION_EXECUTION_AVAILABLE` `false`,
`SEED_DEMO_TENANTS` `false`.

`FLAT_TXN_PRICING_ENABLED` is the only flag in the repository that defaults on.

### 5.2 Other notable defaults

`NODE_ENV=development`, `PLATFORM_MODE=sandbox`, `DATABASE_DRIVER=memory`, `API_PORT=47311`,
`SETTLEMENT_INSTRUCTION_TTL_SECONDS=900`, `PROVIDER_TIMEOUT_MS=4000`,
`MAX_COMPARISON_AMOUNT_MINOR_UNITS=100000000000000`, `RATE_LIMIT_WINDOW_MS=60000`.
`DATABASE_URL`, `AUTH_SECRET`, `ONBOARDING_OPERATOR_SECRET`, `RATE_LIMIT_MAX`, `DEPLOY_ENV` are
optional at the schema level and become required through cross-field refinements.

Eight legal-gate variables are optional strings that become mandatory when their flag flips:
`{AD_VALOREM,GAIN_SHARE,TPV,BILLING}_{LEGAL_OPINION_ID,JURISDICTION}`.

### 5.3 Startup refusals

18 `addIssue`/`ConfigurationError` sites in `env.ts`, plus 2 in `container.ts`. The ones that
define the posture:

1. `DATABASE_DRIVER=memory` forbidden when `NODE_ENV=production` or `PLATFORM_MODE=production`
   (enforced in both `env.ts:240` and `container.ts:141`).
2. `PRODUCTION_EXECUTION_AVAILABLE=true` always rejected (`env.ts:258`).
3. `EXECUTION_ENABLED=true` rejected in a production-locked process (`env.ts:269`).
4. Each of `AD_VALOREM`/`GAIN_SHARE`/`TPV`/`BILLING` `=true` rejected without both its
   `*_LEGAL_OPINION_ID` and `*_JURISDICTION` (`env.ts:280–332`).
5. `PRODUCTION_ROUTING_AVAILABLE=true` only valid when `PLATFORM_MODE=production` (`env.ts:342`)
   — and then rejected at container build because no licensed adapter exists (`container.ts:510`).
6. `SEED_DEMO_TENANTS=true` rejected in production (`env.ts:373`).
7. `AUTH_SECRET` and `ONBOARDING_OPERATOR_SECRET` rejected if they match a known demo value
   (`env.ts:392`, `env.ts:409`).

Consequence worth stating plainly: in production mode both branches of the routing gate are closed.
`PRODUCTION_ROUTING_AVAILABLE=true` throws at startup; `false` starts with an empty provider
registry. A production container cannot price a route at all.

---

## 6. Domain taxonomies

| Taxonomy               | Location                           | Values                                                                         |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| Revenue lifecycle      | `domain/revenue-lifecycle.ts:20`   | `QUOTED_REVENUE`, `EXPECTED_REVENUE`, `ATTRIBUTED_REVENUE`, `REALIZED_REVENUE` |
| Revenue origin         | `domain/revenue-lifecycle.ts:36`   | `DEMO`, `SIMULATION`, `PARTNER_SANDBOX`, `PRODUCTION`                          |
| Settlement finality    | same file                          | `unsettled`, `simulated`, `provider_confirmed`                                 |
| Pricing shapes         | `domain/pricing-shape.ts:17`       | `flat_txn`, `tiered_txn`, `ad_valorem`, `gain_share`, `tpv`                    |
| Billable events        | `domain/billable-event.ts:12`      | `SUBSCRIPTION_PERIOD`, `METERED_CALL`, `FLAT_DECISION`                         |
| Collection modes       | `domain/collection.ts:16`          | `RECORD_ONLY`, `LIVE`                                                          |
| Boundary modes         | `domain/settlement-instruction.ts` | `RETURN_TO_CUSTOMER`, `PARTNER_EXECUTES`                                       |
| Live-enablement scopes | `domain/live-enablement.ts:22`     | 6 scopes (see §4.2 drift note)                                                 |
| Go-live corridors      | `domain/live-enablement.ts:36`     | 10 pairs across USD/KRW/EUR/JPY/GBP                                            |
| Audit event types      | `ports/audit.ts`                   | 91 distinct types                                                              |

The single realized-revenue resolver is `resolveRevenueLifecycle` in
`packages/core/src/domain/revenue-lifecycle.ts:145`. It accumulates four independent cap reasons
(`non_production_origin`, `settlement_not_provider_confirmed`, `recognition_not_collected`,
`collection_reference_missing`) and promotes only when all four are absent **and** the stored
`realizedRevenue` flag is true. `revenueOriginEnvForMode` at line 112 derives the origin stamp from
platform mode, returning `PRODUCTION` only for `mode === 'production'`.

`fundsMoved: false`-style invariant literals appear 280 times across 47 non-test source files.

---

## 7. Outbound network surface

The only `fetch(` calls in non-test API or package source are **two**, both in
`apps/api/src/auth/oidc-client.ts` (OIDC discovery and token endpoint). `packages/adapters` makes
no network calls at all — sandbox pricing is read from two committed data files,
`packages/adapters/data/reference-rates.json` and `sandbox-providers.json`. The web app has one
`fetch` module for server-side calls to its own API.

This is the load-bearing fact behind "generate-and-return produces zero outbound provider calls":
there is no provider HTTP client in the tree to call.

---

## 8. Tests

Full `vitest run` against a migrated **and seeded** PostgreSQL:

| Metric      | Value                           |
| ----------- | ------------------------------- |
| Test files  | 156 (155 passed, 1 skipped)     |
| Test suites | 511                             |
| Test cases  | 1,565 (1,561 passed, 4 skipped) |

| Workspace              | Files | Cases |
| ---------------------- | ----- | ----- |
| `packages/core`        | 70    | 645   |
| `apps/api`             | 58    | 483   |
| `apps/web`             | 13    | 155   |
| `packages/adapters`    | 8     | 144   |
| `packages/persistence` | 7     | 138   |

The 4 skipped cases are `apps/api/src/ops/staging-smoke.test.ts`, which self-skips unless
`STAGING_API_BASE_URL` is set (`describe.skip` at line 13).

Playwright: 8 spec files, 55 tests, covering API contract, routing cases, dashboard, i18n, mobile
layout, legal pages, and agents.

### 8.1 Verified environment prerequisite (finding)

`packages/persistence/src/postgres/prisma-driver.integration.test.ts` (66 tests) requires the test
database to be **seeded**, not merely migrated. Running it against a migrated-but-unseeded database
produces 34 failures, because fixtures reference `org_demo_meridian`. Re-running the same file after
`prisma db seed` gives 66/66. This prerequisite is **not documented** in `README.md` or in the test
file itself, and CI happens to avoid it. It is an inventory finding, not a defect in the tests.

### 8.2 Doc-drift tests that exist

Four test files read a markdown document and assert on its contents, all under `apps/api/src/ops/`:

| Test                                        | Reads                                        |
| ------------------------------------------- | -------------------------------------------- |
| `monetization-documentation.test.ts`        | `docs/MONETIZATION.md`                       |
| `status-documentation.test.ts`              | `docs/API.md`                                |
| `settlement-boundary-documentation.test.ts` | `docs/SETTLEMENT_BOUNDARY.md`, `docs/API.md` |
| `ci-hardening.test.ts`                      | `docs/DEPLOYMENT.md`, `docs/COMPLIANCE.md`   |

So **5 of 24 markdown documents have content-level drift protection**: `API.md`, `MONETIZATION.md`,
`SETTLEMENT_BOUNDARY.md`, `DEPLOYMENT.md`, `COMPLIANCE.md`.

`GO_LIVE_CHECKLIST.md` is coupled more weakly: `ops-live-enablement.test.ts` asserts on
`checklistRef` strings such as `GO_LIVE_CHECKLIST.md#usd-krw` and `#partners` without ever opening
the file, so a test would still pass if those anchors were deleted from the document.

**The remaining 18 documents have no protection at all**, including every architecture and
SSOT-candidate document: `SELVO_ARCHITECTURE_CURRENT.md`, `SELVO_ARCHITECTURE_TARGET.md`,
`SELVO_GAP_ANALYSIS.md`, `MASTER_PRODUCT_DEFINITION.md`, `ARCHITECTURE.md`, `DATABASE.md`,
`PRODUCTION_GATES.md`, `ROADMAP.md`, `README.md`, and the rest.

---

## 9. Documentation

24 markdown files (22 in `docs/`, plus root `README.md` and `GO_LIVE_CHECKLIST.md`), 8,614 lines in
`docs/` alone.

| Document                        | Lines |
| ------------------------------- | ----- |
| `API.md`                        | 1,164 |
| `SELVO_ARCHITECTURE_CURRENT.md` | 753   |
| `PRODUCTION_AUDIT.md`           | 753   |
| `ROADMAP.md`                    | 625   |
| `SELVO_ARCHITECTURE_TARGET.md`  | 549   |
| `TREASURY_DESIGN.md`            | 472   |
| `ARCHITECTURE.md`               | 412   |
| `DATABASE.md`                   | 403   |
| `SELVO_GAP_ANALYSIS.md`         | 402   |
| `PHASE_8_REPORT.md`             | 390   |
| `QUOTE_ENGINE.md`               | 386   |
| `DEPLOYMENT.md`                 | 341   |
| `MONETIZATION.md`               | 273   |
| `PRE_LAUNCH_READINESS.md`       | 264   |
| `SETTLEMENT_BOUNDARY.md`        | 257   |
| `COMPLIANCE.md`                 | 253   |
| `PROVIDERS.md`                  | 211   |
| `MASTER_PRODUCT_DEFINITION.md`  | 184   |
| `PRODUCTION_GATES.md`           | 157   |
| `STACK.md`                      | 134   |
| `AUTH.md`                       | 120   |
| `AGENTS.md`                     | 111   |

### 9.1 Three documentation problems the SSOT rewrite must resolve

**(a) The canonical spec is not in the repository.** `SELVO-CANONICAL-CURSOR-PROMPT.md` — the
document every `§` reference points at — does not exist anywhere in the tree and is named by
no committed file. There are **234 `§n` cross-references** in code comments and docs pointing at a
document a reader cannot open. Most-cited: `§18.3` (27), `§18.5` (23), `§18.2` (20), `§18.6` (17),
`§18.4` (17), `§18.1` (16), `§15` (11), `§2` (10). Any SSOT that keeps this numbering must either
commit the spec or re-anchor the references.

**(b) Two product names are in use.** The code is uniformly `Meridian`: all five packages are
`@meridian/*`, the root package is `meridian`, and 391 non-test source occurrences versus 8 for
`SELVO`. User-visible locale strings say "Meridian" (page titles, meta descriptions, the
non-custodial disclaimer). Documentation is split — `SELVO_ARCHITECTURE_TARGET.md`, `MONETIZATION.md`
and `PHASE_8_REPORT.md` say SELVO; `API.md`, `SETTLEMENT_BOUNDARY.md`, `README.md`, `DEPLOYMENT.md`
and 14 others say Meridian; `SELVO_ARCHITECTURE_CURRENT.md`, `SELVO_GAP_ANALYSIS.md` and
`GO_LIVE_CHECKLIST.md` use both. This is a naming decision the SSOT has to make explicitly,
because renaming reaches package names, the signed-payload literals in
`domain/settlement-instruction.ts`, and every locale file.

**(c) Two incompatible phase-numbering schemes coexist.** Older docs use `PHASE nn` (46 occurrences
in `PRODUCTION_AUDIT.md`, 39 in `TREASURY_DESIGN.md`, 37 in `COMPLIANCE.md`, 24 in
`PRE_LAUNCH_READINESS.md`, 18 in `DEPLOYMENT.md`, 16 in `ROADMAP.md`, 7 in `README.md`). Recent work
uses the canonical spec's `P1–P22` / reordered-`§24` scheme. `SELVO_GAP_ANALYSIS.md:320` holds the
reordered table; steps 3, 4 and 5 of it are the work completed in Phases 8-A, 8-B and 9.

---

## 10. Web surface

Next.js App Router, 25 pages under `apps/web/src/app/[locale]/`: root, `agents`, `defi`,
`developers`, `graph`, `invite`, `login`, `login/sso/callback`, `privacy`, `rails`, `stablecoins`,
`terms`, and 13 `dashboard/*` pages (agents with id/payments/policies, invoices with id, onboarding,
providers, quotes, revenue, settings, transactions).

45 component files including 13 shadcn/ui primitives (`alert`, `badge`, `button`, `card`, `dialog`,
`input`, `label`, `progress`, `select`, `separator`, `skeleton`, `table`, `tooltip`).

8 locales — `de`, `en`, `es`, `fr`, `ja`, `ko`, `pt-BR`, `zh-CN` — each with exactly **452 keys**,
so the catalogs are structurally in sync.

---

## 11. Build, CI, and deployment

`.github/workflows/ci.yml`, 5 jobs, no deploy step and no registry push anywhere:

| Job            | Platform mode              | Database                         | Purpose                                                                                     |
| -------------- | -------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| `verify`       | `sandbox`                  | memory driver + Postgres service | lint, typecheck, `npm test`, `audit:deps`                                                   |
| `e2e`          | (unset)                    | in-memory                        | Playwright on a production build                                                            |
| `e2e-postgres` | `sandbox`                  | postgres, migrated from scratch  | Playwright against empty Postgres                                                           |
| `container`    | n/a                        | n/a                              | `docker build --target api`; fails if the image contains demo credentials or `AUTH_SECRET=` |
| `staging`      | `production` (via compose) | postgres                         | ephemeral local stack, smoke test, `down -v`                                                |

`Dockerfile`: 4 stages (`build`, `migrate`, `pruned`, `api`), non-root uid 1001, healthcheck on
`/health`. The only baked environment is fail-closed: `NODE_ENV=production`,
`PLATFORM_MODE=production`, `DATABASE_DRIVER=postgres`, `PRODUCTION_ROUTING_AVAILABLE=false`,
`PRODUCTION_EXECUTION_AVAILABLE=false`, `SEED_DEMO_TENANTS=false`. No secret is baked.

### 11.1 Repository-wide formatting is not clean (finding)

`npm run format:check` reports **310 files** with Prettier differences, including files no recent
phase touched (for example `vitest.config.ts`). `format:check` is not part of `npm run verify`
(`verify` = lint + typecheck + test) and is not a CI job, so this has never gated. It is pre-existing
and repository-wide, not attributable to any one phase, but it means Prettier cannot currently be
made a gate without a large mechanical commit.

---

## 12. Current posture summary

Everything in this section was verified by execution, not read from documentation.

| Question                                                       | Answer                               | Evidence                                                                                              |
| -------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Does `POST /api/v1/executions` execute?                        | No — 501 `EXECUTION_NOT_IMPLEMENTED` | Live HTTP call                                                                                        |
| Can an execution intent be executable or submitted?            | No                                   | Two CHECK constraints pin both false                                                                  |
| Is Pattern A functional?                                       | Yes                                  | Signed instruction verified offline by a third-party Python script using only the published JWKS      |
| Does generating or countersigning an instruction move revenue? | No                                   | 0 realized, 0 collected, 0 provider-confirmed rows after a full generate → sign → customer-sign cycle |
| Can SELVO transmit on a customer's behalf?                     | No                                   | No provider HTTP client exists; no dispatch column exists; service imports nothing that dispatches    |
| Which pricing shapes charge anything?                          | Only `flat_txn`                      | Sole flag defaulting true                                                                             |
| Are invoices collected?                                        | No                                   | `RECORD_ONLY`, and `invoices_issuer_unconfirmed` / `invoices_tax_zero` still pin the entity and tax   |
| Can a production container price a route?                      | No                                   | Both branches of the routing gate are closed (see §5.3)                                               |
| Are the signing keys production-grade?                         | No                                   | Generated in-process, stored AES-encrypted in the credential vault; no KMS or HSM                     |

---

## 13. Open items carried into reconciliation

Ordered by how much they affect the SSOT rewrite, not by severity.

1. **The canonical spec is uncommitted** (§9.1a). 236 `§n` references point at a document not in
   the repository. Resolve before the SSOT inherits the numbering.
2. **Meridian vs SELVO is unresolved** (§9.1b). Affects package names, signed payload literals, and
   all 8 locale catalogs.
3. **Two phase-numbering schemes** (§9.1c). `PHASE nn` in 7 documents, `P1–P22` in the recent ones.
4. **`live_enablements_scope_check` admits 3 of 6 declared scopes** (§4.2). Latent today because the
   three pricing flags are off; blocking the moment one is enabled.
5. **18 of 24 documents have no drift test** (§8.2), including every architecture document. A
   nineteenth, `GO_LIVE_CHECKLIST.md`, is coupled only through unverified anchor strings.
6. **Postgres integration tests need a seeded database** (§8.1), undocumented.
7. **310 files fail `format:check`** (§11.1), ungated and pre-existing.
8. **Signing-key custody** (§12). Vault-encrypted is adequate pre-launch; KMS or HSM is required
   before production signing.

### UNVERIFIED

- Whether `docs/SELVO_ARCHITECTURE_CURRENT.md`, `SELVO_ARCHITECTURE_TARGET.md` and
  `SELVO_GAP_ANALYSIS.md` still describe the tree accurately after Phases 8 and 9. They were written
  before both and have no drift test. Their accuracy was **not** audited for this inventory; doing so
  is reconciliation work, not inventory work.
- Whether the `PHASE nn` numbers in the seven older documents map cleanly onto `P1–P22`. No mapping
  table exists in the repository.
