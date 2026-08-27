-- Phase 17: quoted (never settled) multi-rail monetization ledger.
-- Amounts are DECIMAL(38,0) minor units. Binary floating types are forbidden. funds_moved is always false.

CREATE TABLE "monetization_events" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "transaction_type" TEXT NOT NULL,
  "revenue_source" TEXT NOT NULL,
  "rail" TEXT,
  "provider_id" TEXT,
  "provider_name" TEXT,
  "currency" VARCHAR(16) NOT NULL,
  "asset" VARCHAR(16) NOT NULL,
  "destination_asset" VARCHAR(16),
  "agent_id" TEXT,
  "tpv_minor_units" DECIMAL(38, 0) NOT NULL,
  "provider_cost_minor_units" DECIMAL(38, 0) NOT NULL,
  "platform_revenue_minor_units" DECIMAL(38, 0) NOT NULL,
  "partner_commission_minor_units" DECIMAL(38, 0) NOT NULL,
  "gross_profit_minor_units" DECIMAL(38, 0) NOT NULL,
  "take_rate_bps" DECIMAL(12, 4),
  "funds_moved" BOOLEAN NOT NULL DEFAULT false,
  "custody" BOOLEAN NOT NULL DEFAULT false,
  "real_execution" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "monetization_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "monetization_events_funds_moved_false" CHECK ("funds_moved" = false),
  CONSTRAINT "monetization_events_custody_false" CHECK ("custody" = false),
  CONSTRAINT "monetization_events_real_execution_false" CHECK ("real_execution" = false),
  CONSTRAINT "monetization_events_amounts_non_negative" CHECK (
    "tpv_minor_units" >= 0
    AND "provider_cost_minor_units" >= 0
    AND "platform_revenue_minor_units" >= 0
    AND "partner_commission_minor_units" >= 0
  )
);

ALTER TABLE "monetization_events"
  ADD CONSTRAINT "monetization_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "monetization_events_organization_id_occurred_at_idx"
  ON "monetization_events"("organization_id", "occurred_at" DESC);

CREATE INDEX "monetization_events_organization_id_revenue_source_idx"
  ON "monetization_events"("organization_id", "revenue_source");

CREATE INDEX "monetization_events_organization_id_rail_idx"
  ON "monetization_events"("organization_id", "rail");
