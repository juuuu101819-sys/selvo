-- PHASE 32: platform-fee invoices copied from monetization snapshots.
-- Payment collection, tax calculation, and issuer legal entity are deferred.
-- realized_revenue may be true only when revenue_recognition is collected; this phase never writes collected.

ALTER TABLE "monetization_events"
  ADD COLUMN "revenue_recognition" TEXT NOT NULL DEFAULT 'unrealized',
  ADD COLUMN "invoice_id" TEXT;

ALTER TABLE "monetization_events"
  ADD CONSTRAINT "monetization_events_revenue_recognition_known"
  CHECK ("revenue_recognition" IN ('unrealized', 'invoiced', 'collected'));

ALTER TABLE "monetization_events"
  ADD CONSTRAINT "monetization_events_realized_revenue_collected_chk"
  CHECK (
    ("realized_revenue" = false AND "revenue_recognition" IN ('unrealized', 'invoiced'))
    OR ("realized_revenue" = true AND "revenue_recognition" = 'collected')
  );

CREATE TABLE "invoices" (
  "id" TEXT NOT NULL,
  "invoice_number" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "period_start" TIMESTAMPTZ(3) NOT NULL,
  "period_end" TIMESTAMPTZ(3) NOT NULL,
  "currency" VARCHAR(16) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'issued',
  "collection_status" TEXT NOT NULL DEFAULT 'uncollected',
  "issuer_legal_entity" TEXT NOT NULL DEFAULT 'unconfirmed',
  "tax_calculation" TEXT NOT NULL DEFAULT 'deferred',
  "subtotal_minor_units" DECIMAL(38,0) NOT NULL,
  "tax_minor_units" DECIMAL(38,0) NOT NULL,
  "total_minor_units" DECIMAL(38,0) NOT NULL,
  "issued_at" TIMESTAMPTZ(3) NOT NULL,
  "issued_by_actor" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number"),
  CONSTRAINT "invoices_organization_id_period_start_currency_key" UNIQUE ("organization_id", "period_start", "currency"),
  CONSTRAINT "invoices_status_issued" CHECK ("status" = 'issued'),
  CONSTRAINT "invoices_collection_uncollected" CHECK ("collection_status" = 'uncollected'),
  CONSTRAINT "invoices_issuer_unconfirmed" CHECK ("issuer_legal_entity" = 'unconfirmed'),
  CONSTRAINT "invoices_tax_deferred" CHECK ("tax_calculation" = 'deferred'),
  CONSTRAINT "invoices_tax_zero" CHECK ("tax_minor_units" = 0),
  CONSTRAINT "invoices_amounts_non_negative" CHECK (
    "subtotal_minor_units" >= 0
    AND "tax_minor_units" >= 0
    AND "total_minor_units" >= 0
  ),
  CONSTRAINT "invoices_total_matches_subtotal_plus_tax" CHECK (
    "total_minor_units" = "subtotal_minor_units" + "tax_minor_units"
  ),
  CONSTRAINT "invoices_period_order" CHECK ("period_end" > "period_start")
);

CREATE INDEX "invoices_organization_id_issued_at_idx"
  ON "invoices"("organization_id", "issued_at" DESC);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "invoice_lines" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "monetization_event_id" TEXT NOT NULL,
  "platform_revenue_minor_units" DECIMAL(38,0) NOT NULL,
  "economic_stage" TEXT NOT NULL,
  "transaction_type" TEXT NOT NULL,
  "revenue_source" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_lines_monetization_event_id_key" UNIQUE ("monetization_event_id"),
  CONSTRAINT "invoice_lines_platform_revenue_non_negative" CHECK ("platform_revenue_minor_units" >= 0)
);

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_monetization_event_id_fkey"
  FOREIGN KEY ("monetization_event_id") REFERENCES "monetization_events"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "monetization_events"
  ADD CONSTRAINT "monetization_events_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "monetization_events_invoice_id_idx" ON "monetization_events"("invoice_id");
