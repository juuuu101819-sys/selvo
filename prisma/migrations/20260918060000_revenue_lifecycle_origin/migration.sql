-- Revenue lifecycle reconciliation (spec §18.2).
--
-- Before this migration "realized revenue" had three disagreeing definitions: the
-- `monetization_events_realized_revenue_collected_chk` constraint tied `realized_revenue` to
-- `revenue_recognition = 'collected'`, the dashboard summed `economic_stage = 'settled'`, and the
-- application hardcoded `realized_revenue = false` on every read. The middle definition was
-- reachable by a sandbox mock partner, so a simulated run inflated a total labelled "realized
-- revenue".
--
-- These columns supply the two facts realization actually requires -- a production origin and
-- provider-confirmed finality -- plus the collection reference that proves payment. The CHECK
-- constraints below make the rules enforceable in the database, not just in the resolver.

ALTER TABLE "monetization_events"
  ADD COLUMN "origin_env" TEXT NOT NULL DEFAULT 'SIMULATION',
  ADD COLUMN "settlement_finality" TEXT NOT NULL DEFAULT 'unsettled',
  ADD COLUMN "collection_reference" TEXT;

-- Existing rows predate origin stamping. They are all `unrealized` and were produced by the
-- sandbox demo tenant or by quote/intent attribution, so none of them can realize regardless of
-- this value. 'SIMULATION' is the fail-closed choice: a genuine production quote misfiled here
-- resolves to QUOTED_REVENUE either way, whereas defaulting to 'PRODUCTION' would make a
-- simulated row eligible for promotion if it were later collected.
UPDATE "monetization_events" SET "origin_env" = 'SIMULATION' WHERE "origin_env" IS NULL;

-- Sandbox orchestration wrote `settled` after a mock partner reported success. Record that as
-- simulated finality so it stays visible as attribution without ever counting as cash.
UPDATE "monetization_events"
  SET "settlement_finality" = 'simulated'
  WHERE "economic_stage" = 'settled';

ALTER TABLE "monetization_events"
  ADD CONSTRAINT "monetization_events_origin_env_known"
    CHECK ("origin_env" IN ('DEMO', 'SIMULATION', 'PARTNER_SANDBOX', 'PRODUCTION')),
  ADD CONSTRAINT "monetization_events_settlement_finality_known"
    CHECK ("settlement_finality" IN ('unsettled', 'simulated', 'provider_confirmed')),
  -- Realization requires a production origin. A DEMO, SIMULATION, or PARTNER_SANDBOX row can
  -- never be cash, whatever status a mock partner reports.
  ADD CONSTRAINT "monetization_events_realized_requires_production"
    CHECK ("realized_revenue" = false OR "origin_env" = 'PRODUCTION'),
  -- Realization requires a provider to have confirmed finality. `simulated` is not enough.
  ADD CONSTRAINT "monetization_events_realized_requires_finality"
    CHECK ("realized_revenue" = false OR "settlement_finality" = 'provider_confirmed'),
  -- Realization requires the processor reference that proves collection. "The call did not
  -- error" is not collection.
  ADD CONSTRAINT "monetization_events_realized_requires_collection_ref"
    CHECK ("realized_revenue" = false OR "collection_reference" IS NOT NULL),
  -- A collection reference only makes sense once recognition reached `collected`.
  ADD CONSTRAINT "monetization_events_collection_ref_requires_collected"
    CHECK ("collection_reference" IS NULL OR "revenue_recognition" = 'collected');

CREATE INDEX "monetization_events_organization_id_origin_env_idx"
  ON "monetization_events" ("organization_id", "origin_env");
