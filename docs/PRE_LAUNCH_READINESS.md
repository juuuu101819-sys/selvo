# GLOBAL NON-CUSTODIAL FINANCIAL ROUTING HUB
## PRE-LAUNCH READINESS REPORT (PHASE 39)

**Product:** Meridian — non-custodial financial routing hub  
**Launch path in scope:** Referral-model MVP (quote / compare / recommend + attributed take-rate / referral on quoting activity). **No live execution.**  
**Date:** 29 August 2026  
**Method:** Full read of `docs/PRODUCTION_AUDIT.md`, `docs/ROADMAP.md`, `docs/COMPLIANCE.md`, `docs/DEPLOYMENT.md`, `docs/TREASURY_DESIGN.md`; regression tests against running code; live sandbox (`127.0.0.1:47311`) and production-locked local staging (`127.0.0.1:47331`); `npm audit --audit-level=moderate`.  
**Constraint:** PHASE 30 / 33 / 35 / 36 business-gated items are **out of scope for this launch path** and are not treated as failures.

---

### 1. Overall Readiness (for the referral-model MVP launch path, NOT full execution)

**READY**

Software controls for a non-custodial quoting/routing MVP hold. Live execution remains disabled. Licensed-partner adapters, payment collection, subscriptions, and partner payouts remain correctly unimplemented pending external confirmation.

---

### 2. Completion %

**94% of the referral-model MVP path** (not of a full execution/custody product).

Basis:

| Bucket | Weight in this path | State |
| ------ | ------------------- | ----- |
| PA-C01–C03 fail-closed production boot | required | Verified FIXED |
| PA-H01–H13 authorization + financial integrity | required | Verified FIXED |
| PA-M01–M08, M10–M16, PA-L01–L04, L06 | required | Verified FIXED (SCIM and worker queue remain explicitly out of scope) |
| PHASE 38 kill switch, vault, isolation, custody guardrail, sandbox labeling | required | Verified FIXED |
| Quote/compare UX + OpenAPI + 501 execution gate | required | Verified live |
| Positioning copy honesty | required | One honesty regression found and fixed this phase |
| PA-M09 remainder / PA-L05 / PHASE 30/33/35/36 | **not** in this path | Deferred / business-gated — excluded from the denominator |
| Legal `COMPLIANCE_BOUNDARY_DRAFT.md` + third-party APM | residual | Missing as artifacts (P1 legal / P2 ops), not software blockers |

The remaining ~6% is counsel-owned boundary copy, optional APM wiring, and the already-gated partner/execution/billing work.

---

### 3. Verified-Already-Fixed Items

Audit status from `docs/PRODUCTION_AUDIT.md`, re-checked against tests and/or live API on 2026-08-29. Do not re-implement.

| ID | Audit status | PHASE 39 | Evidence (implementing files / tests) |
| -- | ------------ | -------- | ------------------------------------- |
| PA-C01 | FIXED | **VERIFIED** | `apps/api/src/container.ts`, `apps/api/src/config/env.ts`, `packages/core/src/engine/provider-registry.ts`; `production-gates.test.ts`, `env.test.ts`. Live staging: `productionGates.routingAvailable=false`, empty licensed registry, comparison **422** `UNSUPPORTED_CORRIDOR`. |
| PA-C02 | FIXED | **VERIFIED** | `packages/core/src/auth/production-credentials.ts`, `apps/api/src/app.ts`; `production-credentials.test.ts`. Live staging demo login **401**. |
| PA-C03 | FIXED | **VERIFIED** | `apps/api/src/config/env.ts`. Live staging `persistenceDriver=postgres`; production+memory rejected in `env.test.ts`. |
| PA-H01 | FIXED | **VERIFIED** | `apps/api/src/routes/dashboard.ts`; `agent-dashboard.test.ts` (viewer/member PATCH 403). |
| PA-H02 | FIXED | **VERIFIED** | `packages/core/src/domain/api-scope.ts`; `api-scope.test.ts`, `agent-payments.test.ts`, `execution-intents.test.ts`. |
| PA-H03 | FIXED | **VERIFIED** | `apps/api/src/routes/execution-intents.ts`, `packages/core/src/engine/agent-payment-service.ts`; `execution-intents.test.ts`, `policy-hardening.test.ts`. |
| PA-H04 | FIXED | **VERIFIED** | `packages/core/src/domain/agent-payments.ts`, exclusive agent lock; `policy-hardening.test.ts` concurrent reservation. |
| PA-H05 | FIXED | **VERIFIED** | `ComparisonRoutingService` / `MultiRailRouter` 1.0.0; `comparisons-multirail.test.ts`. Live sandbox comparison `engineVersion` **1.0.0**, four ranked routes. |
| PA-H06 | FIXED | **VERIFIED** | `packages/core/src/graph/build-graph.ts`; `build-graph.test.ts`. Staging graph/catalog empty (no licensed metadata). |
| PA-H07 | FIXED | **VERIFIED** | `packages/persistence/src/dashboard/aggregate.ts`, `apps/web/src/lib/chart-display.ts`; `aggregate.test.ts`, `chart-display.test.ts`. |
| PA-H08 | FIXED | **VERIFIED** | `apps/api/src/monetization/record.ts`, `packages/core/src/engine/monetization-engine.ts`; `routing-monetization.test.ts`, `monetization-engine.test.ts`. No `realizedRevenue: true` write path. |
| PA-H09 | FIXED | **VERIFIED** | Rail freshness; `quote-freshness-selection.test.ts`, `quote-selection.test.ts`. Live quote `freshness.state=fresh` with `quotedAt` / `expiresAt`. |
| PA-H10 | FIXED | **VERIFIED** | `routing-platform-fees.test.ts` — take-rate once per route, not per leg. |
| PA-H11 | FIXED | **VERIFIED** | `.github/workflows/ci.yml` (`npm ci`, verify, e2e, `audit:deps`, docker build); `ci-hardening.test.ts`. |
| PA-H12 | FIXED | **VERIFIED** | `deepmerge-ts@8.0.2` override; `npm run audit:deps` → **0 vulnerabilities**. |
| PA-H13 | FIXED | **VERIFIED** | Statuses remain `POLICY_APPROVED` / `SIMULATION_PENDING` / `SIMULATION_COMPLETED`; `financial-status.test.ts`, `status-documentation.test.ts`. No rename this phase. |
| PA-M01 | FIXED | **VERIFIED** | `packages/core/src/crypto/secrets.ts` salted scrypt + `timingSafeEqual`; `secrets.test.ts`, `phase24-security.test.ts` (one-time raw secret). |
| PA-M02 | FIXED | **VERIFIED** | Postgres `rate_limit_buckets`; keyed by authenticated principal; `rate-limit.test.ts`. |
| PA-M03 | FIXED | **VERIFIED** | `apps/api/src/http/public-error.ts`; `public-error.test.ts`. Live 501 body is a safe DTO (no stack / SQL). |
| PA-M04 | FIXED | **VERIFIED** | Server-derived actor only; `authentication.test.ts`, `executions.test.ts`. |
| PA-M05 | FIXED | **VERIFIED** | `GET /api/v1/openapi.json` **200**, OpenAPI 3.0.3; `openapi.test.ts`. Public `/comparisons` vs billed `/quote`. |
| PA-M06 | FIXED | **VERIFIED** | `docs/AGENTS.md` documents `mag_` issuance; `agent-payments.test.ts`. |
| PA-M07 | FIXED | **VERIFIED** | Keyset cursor; `pagination.test.ts` (full suite 1156). |
| PA-M08 | FIXED | **VERIFIED** | Daily-spend indexes + CI postgres; schema + `policy-hardening.test.ts`. |
| PA-M10 | FIXED | **VERIFIED** | `routing_evaluations` fingerprint/replay; ranking version still **1.0.0**. |
| PA-M11 | FIXED | **VERIFIED** | `preferredRoutePreference` is a policy ranking input; `route-preference.test.ts`. |
| PA-M12 | FIXED | **VERIFIED** | `session-cookie.test.ts` — Secure required in `PLATFORM_MODE=production`; HttpOnly; SameSite=Lax. |
| PA-M13 | FIXED | **VERIFIED** | Dashboard session gate; `session-gate.test.ts`, `middleware.test.ts`. |
| PA-M14 | FIXED | **VERIFIED** | External-account wording; `controlledByPlatform` CHECK false. |
| PA-M15 | FIXED | **VERIFIED** | `auth.login.failed` / `auth.credential.failed`; `auth-failure-audit.test.ts`. |
| PA-M16 | FIXED | **VERIFIED** | `parseApiScopesStrict`; unknown scopes rejected. |
| PA-L01 | FIXED | **VERIFIED** | Display Decimal formatters; `apps/web/src/lib/format.test.ts`. |
| PA-L02 | FIXED | **VERIFIED** | `ExecutionIntentStatus` enum `{ recorded }`. |
| PA-L03 | FIXED (SSO/MFA); SCIM out of scope | **VERIFIED** | TOTP + OIDC present; SCIM not in this launch path. |
| PA-L04 | FIXED (cache/breaker); worker queue out of scope | **VERIFIED** | Quote cache + circuit breaker; `quoteCircuits` on live `/meta`. |
| PA-L06 | FIXED | **VERIFIED** | CI `e2e-postgres` job; `ci-hardening.test.ts`. |
| PHASE 38 kill switch | shipped | **VERIFIED** | `ops-routing.test.ts`; live `/meta.manualOverrides.autoReset=false`. |
| PHASE 38 custody guardrail | shipped | **VERIFIED** | `packages/core/src/domain/custody-guardrail.test.ts`. |
| PHASE 38 tenant isolation | shipped | **VERIFIED** | `apps/api/src/routes/tenant-isolation.test.ts` (OpenAPI catalog). |
| `POST /api/v1/executions` | 501 by design | **VERIFIED** | Live sandbox **501** `EXECUTION_NOT_IMPLEMENTED`; live staging **501**; `executions.test.ts`. |

---

### 4. Regressions Found (if any)

| ID | What broke | Fix applied |
| -- | ---------- | ----------- |
| Positioning copy (not a PA-*) | Landing hero previously implied licensed settlement / delegated partners while PHASE 30 has no partner. `best-route.tsx` / `route-card.tsx` said multi-hop legs settle “through licensed partners.” | Copy now states quotes are indicative and sandbox-labelled until a licensed partner is connected; Meridian does not execute or delegate settlement. Intermediary-leg copy no longer claims licensed on/off-ramps. Regression test: `apps/web/src/app/layout.test.ts`. |

No PA-C / PA-H / PA-M / PA-L control regressed. Status names were **not** renamed.

---

### 5. Genuinely Missing Items (if any)

| ID | Why missing | Recommended fix | Priority |
| -- | ----------- | --------------- | -------- |
| `docs/COMPLIANCE_BOUNDARY_DRAFT.md` | Never authored. In-repo boundary lives in `docs/COMPLIANCE.md` + `docs/MASTER_PRODUCT_DEFINITION.md`. Counsel-facing draft was not invented this phase. | Legal/compliance drafts the boundary outside Cursor; do not generate ToS or licence claims in-app. | P1 (counsel), not a software launch blocker |
| Third-party APM (Sentry/Datadog/Prometheus) | Observability is JSON stdout + `/health` + `/ready` + `/meta` + auth-failure/rate-limit audit, as documented in `docs/DEPLOYMENT.md` §3. No APM product was added (would be invented infrastructure). | Attach the existing stdout drain to the host platform’s log/metrics stack when an operator is chosen. | P2 |
| Docker Compose staging on this VM | `docker` is not installed here. Equivalent production-locked process already listening on `127.0.0.1:47331`; `npm run test:staging-smoke` **passed** (4). CI still builds the canonical image. | Use `docker-compose.staging.yml` in an environment that has Docker; local script remains the fallback. | P2 (ops environment), not a product gap |
| PA-M09 remainder | Invoices only. Collection, tax, subscriptions, partner AP deferred (PHASE 35/36 unconfirmed). | Re-run PHASE 35/36 after legal entity / processor / tier / payout confirmation. | Deferred — **not a blocker for this path** |
| PA-L05 | A2A / treasury-as-product / KYC-as-product. Treasury is design-only (`docs/TREASURY_DESIGN.md`). | Do not implement in-platform balances. | Deferred — **not a blocker for this path** |

---

### 6. Security — **PASS**

- Fail-closed production boot: PA-C01–C03 tests + live staging postgres, no demo tenant, no licensed adapters invented.
- Credential hashing: salted scrypt, constant-time verify, one-time raw display (`secrets.test.ts`, `phase24-security.test.ts`).
- Rate limiting: shared store, principal-keyed (`rate-limit.test.ts`).
- Error DTO: no stack/DB/provider leakage (`public-error.test.ts`; live 501 inspected).
- Audit actor: server-derived (`authentication.test.ts`).
- Cookies: Secure/HttpOnly/SameSite in production (`session-cookie.test.ts`).
- Kill switch: operator override, audited, visible on `/meta`, no auto-reset (`ops-routing.test.ts`).
- Dependency audit: `npm run audit:deps` → 0 moderate+.
- Full unit/integration: **116 files, 1156 tests passed** (includes PHASE 39 copy test).

---

### 7. Financial Integrity — **PASS**

- Single ranking engine on `/comparisons` (MultiRailRouter **1.0.0**). Live sandbox USD→KRW returned four routes with quote timestamps and freshness.
- Monetization recorded as quoted / unrealized; `ROUTE_QUOTE` ≠ selection ≠ execution intent ≠ settlement ≠ `REALIZED_REVENUE`. Nothing writes `realizedRevenue: true` or `economicStage: settled`.
- Platform fee once per route (`routing-platform-fees.test.ts`).
- Decimal/`bigint` aggregates (`aggregate.test.ts`).
- PA-H13 names unchanged; no status implies settlement without an external confirmation event (none exists).

---

### 8. Multi-Rail — **PASS**

- Fiat / stablecoin / DeFi share MultiRailRouter; freshness per rail; expired quotes excluded.
- Production route graph does not silently use demo data (`build-graph.test.ts`; staging catalog empty).
- Sandbox providers labelled `unlicensed_sandbox`; UI badge **Sandbox** (`licensing.test.ts`).
- `ROUTING_ENGINE_VERSION` remains **1.0.0** (not bumped).

---

### 9. AI Safety — **PASS**

- NL parser does not compute rates/fees/settlement amounts; `nl-intent-parser.test.ts`, `nl-routing.test.ts`.
- Ambiguous merchant / unknown instruction fail closed (clarification / deny), not a best-guess execution.
- Policy engine still required before execution-intent persistence (PA-H03).
- `POST /executions` remains 501 even after policy approval / simulation.

---

### 10. Org Isolation — **PASS**

- `apps/api/src/routes/tenant-isolation.test.ts` walks the OpenAPI-catalogued tenant surfaces (cross-tenant 404).
- Staging has no demo tenant; demo login 401 (PA-C02). Live multi-tenant traffic against staging was not invented (no synthetic operator password in this environment); isolation evidence is the catalog suite, which is the PHASE 38 contract.

---

### 11. Production Config — **PASS**

- Live staging (`DEPLOY_ENV=staging`, `PLATFORM_MODE=production`, postgres): `/health` ok, `/ready` ready, `productionGates` both false, `execution.statusCode` 501, `capabilities.executeTransactions` / `custodyFunds` false.
- Comparison/quote in production-locked mode **422** (empty licensed registry) — correct until PHASE 30.
- `PRODUCTION_EXECUTION_AVAILABLE=true` remains a startup failure; `/executions` stays 501.
- Memory driver forbidden when production-locked (`env.test.ts`).

---

### 12. API — **PASS**

- `GET /api/v1/openapi.json` 200, OpenAPI 3.0.3, title `financial-router`.
- `docs/API.md` worked example: `POST /api/v1/comparisons` with `{ sourceCurrency, targetCurrency, amount }` is sufficient for a sandbox quote. Authenticated `POST /quote` requires `quote:read` (401 anonymous — verified on staging).
- `POST /api/v1/executions` documented and live **501**.
- Kill switch / meta / OpenAPI coverage tests pass.

---

### 13. Monitoring — **PASS** (stdout / health / audit; no invented APM)

- `/health`, `/ready`, `/meta` (gates, circuits, manual overrides, image tag).
- JSON logs; pino redaction of secrets (`docs/DEPLOYMENT.md` §2–3).
- Auth-failure audit (PA-M15); HTTP 429 rate-limit events (PA-M02).
- PostgreSQL backup: documented `pg_dump` before migrate (`docs/DEPLOYMENT.md` §4). Forward-only migrations including PA-H13 rename and PHASE 38 additive tables.
- Gap (P2): no in-repo Sentry/Datadog — attach platform drain; do not add a second logger.

---

### 14. Documentation — **PASS** (in-repo); legal draft file absent

- `COMPLIANCE.md`, `PRODUCTION_GATES.md`, `DEPLOYMENT.md`, `API.md`, `MASTER_PRODUCT_DEFINITION.md` state non-custodial, not a bank/broker/exchange, 501 execution, PHASE 30/33/35/36 gates.
- Landing + README copy aligned this phase; `layout.test.ts` guards identity claims.
- `docs/COMPLIANCE_BOUNDARY_DRAFT.md` **does not exist**. Do not treat that as a failed software control; counsel should author it. In-repo equivalent: `docs/COMPLIANCE.md`.

---

### 15. Execution Safety Gate

**LIVE EXECUTION DISABLED (PHASE 33 pending business/legal confirmation)**

Evidence: `apps/api/src/routes/executions.ts`; live `POST http://127.0.0.1:47311/api/v1/executions` → **501** `EXECUTION_NOT_IMPLEMENTED`; live `POST http://127.0.0.1:47331/api/v1/executions` → **501**; `executions.test.ts`; staging smoke.

---

### 16. Business-Gated Items Status (informational, not blockers for this launch path)

| Item | Status |
| ---- | ------ |
| PHASE 30 (licensed provider) | **Blocked.** No named licensed partner of record. Production quoting correctly empty (422). Do not invent an adapter. |
| PHASE 33 (execution) | **Blocked.** Four COMPLIANCE.md gates unconfirmed. `/executions` stays 501. |
| PHASE 35 (payment collection) | **Blocked.** `issuerLegalEntity=unconfirmed`, tax `0`, `DeferredPlatformFeeCollector` does not collect. |
| PHASE 36 (billing/partner) | **Blocked.** No subscription catalog, no payout ledger. PA-M09 **PARTIAL** (invoices only). |
| Compliance Boundary review | **In-repo COMPLIANCE.md current.** Counsel-facing `COMPLIANCE_BOUNDARY_DRAFT.md` not present (P1 legal). Treasury remains design-only (PHASE 37). |

These are **correctly out of scope** until confirmed outside Cursor. They are not launch failures for the referral-model MVP.

---

### 17. Remaining Work (P0/P1/P2/P3)

**P0** — None for this launch path.

**P1**

- Counsel authors `COMPLIANCE_BOUNDARY_DRAFT.md` (or equivalent) from `docs/COMPLIANCE.md`; do not invent ToS in the product.
- When a named licensed partner exists, run PHASE 30 (adapter + credential vault already present). Not required to ship sandbox quoting + referral attribution.

**P2**

- Attach JSON stdout to CloudWatch / Datadog / equivalent; optional 5xx/latency dashboards.
- Run canonical `docker-compose.staging.yml` in an environment with Docker (local staging smoke already passed without Compose).

**P3**

- SCIM (PA-L03 remainder), worker queue (PA-L04 remainder), PA-L05 product, Treasury implementation (only after `TREASURY_DESIGN.md` §5 answers — and never as in-platform balances).

**Explicitly not remaining work for this path:** subscription tiers, live execution, custody, fake licensed adapters, lifting the 501, inventing payment collection.

---

### 18. Final Recommendation

**READY TO LAUNCH (referral-model MVP)**

Ship the sandbox/staging quoting hub that ranks routes, labels unlicensed results as Sandbox, attributes unrealized take-rate/referral on qualifying quote events, and refuses execution with an audited 501.

Not a recommendation to: enable live execution, collect platform-fee cash, sell named billing tiers, or present sandbox quotes as licensed/live/settled.

---

## PHASE 39 evidence appendix

| Check | Result |
| ----- | ------ |
| `npm test` | 116 files, **1156** passed |
| Targeted PA + isolation + custody + 501 + copy | 36 files / 238 + 7 files / 59 (overlapping) passed |
| `npm run audit:deps` | 0 vulnerabilities |
| `STAGING_API_BASE_URL=http://127.0.0.1:47331 npm run test:staging-smoke` | 4 passed |
| Live sandbox comparison USD 100k→KRW | 201, engine 1.0.0, 4 routes, `licensing=unlicensed_sandbox`, freshness present, sandbox disclaimer |
| Live `POST /executions` sandbox + staging | 501 `EXECUTION_NOT_IMPLEMENTED` |
| Live staging comparison | 422 `UNSUPPORTED_CORRIDOR` |
| Live staging demo login | 401 |
| `GET /api/v1/openapi.json` | 200 |
| Docker Compose on this VM | not available; local production-locked process used instead |
