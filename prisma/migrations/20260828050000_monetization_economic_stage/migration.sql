-- Phase 21: auditable unrealized monetization metadata (route id, quote id, funnel stage).
-- realized_revenue defaults false. This migration does not invent settlement rows.

ALTER TABLE "monetization_events"
  ADD COLUMN "route_id" TEXT,
  ADD COLUMN "quote_id" TEXT,
  ADD COLUMN "economic_stage" TEXT NOT NULL DEFAULT 'route_quote',
  ADD COLUMN "realized_revenue" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "monetization_events_organization_id_economic_stage_idx"
  ON "monetization_events"("organization_id", "economic_stage");
