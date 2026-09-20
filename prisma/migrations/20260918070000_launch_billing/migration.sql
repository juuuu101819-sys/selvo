-- Launch billing: usage metering, subscription tiers, and the collection layer (spec §18.1, §18.5, §18.6).
--
-- Three things did not exist before this migration: any per-API-call meter, any subscription tier
-- assignment, and any record of an attempt to collect an invoice. Invoices could only be built
-- from routed decisions, and `collection_status` had exactly one reachable value.
--
-- The load-bearing constraint here is the unique index on `collection_attempts.idempotency_key`.
-- It is what makes a retry safe: a duplicate webhook or an impatient operator finds the existing
-- row instead of charging the customer a second time. Enforcing it in the database rather than in
-- the service means a concurrent second attempt loses on insert instead of racing.

-- ---------------------------------------------------------------------------
-- Invoice lines gain a charge class (§18.6), so one logical action maps to exactly one charge.
-- ---------------------------------------------------------------------------

ALTER TABLE "invoice_lines"
  ADD COLUMN "event_class" TEXT NOT NULL DEFAULT 'FLAT_DECISION',
  ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "quantity" DECIMAL(38, 0) NOT NULL DEFAULT 1;

-- Every existing line was copied from a routed decision snapshot, which is exactly the
-- FLAT_DECISION class, so the column default already describes them correctly.

-- Subscription and metered lines bill a period rather than one decision and have no snapshot to
-- point at. The column was NOT NULL because a snapshot was the only thing a line could be.
ALTER TABLE "invoice_lines"
  ALTER COLUMN "monetization_event_id" DROP NOT NULL;

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_event_class_known"
    CHECK ("event_class" IN ('SUBSCRIPTION_PERIOD', 'METERED_CALL', 'FLAT_DECISION')),
  -- A decision fee must name the decision it charges for; a period fee must not claim one.
  ADD CONSTRAINT "invoice_lines_snapshot_matches_class"
    CHECK (
      ("event_class" = 'FLAT_DECISION' AND "monetization_event_id" IS NOT NULL)
      OR ("event_class" <> 'FLAT_DECISION' AND "monetization_event_id" IS NULL)
    ),
  ADD CONSTRAINT "invoice_lines_quantity_positive" CHECK ("quantity" >= 0);

CREATE INDEX "invoice_lines_invoice_id_event_class_idx"
  ON "invoice_lines" ("invoice_id", "event_class");

-- ---------------------------------------------------------------------------
-- Invoices record which mode produced them and, once paid, the processor's reference.
-- ---------------------------------------------------------------------------

ALTER TABLE "invoices"
  ADD COLUMN "collection_mode" TEXT NOT NULL DEFAULT 'RECORD_ONLY',
  ADD COLUMN "collection_reference" TEXT;

-- Existing invoices were all issued while collection was impossible, so RECORD_ONLY is accurate
-- rather than merely a safe default.

-- `invoices_collection_uncollected` pinned every invoice to `uncollected` unconditionally, because
-- when it was written there was no collection layer at all, so any other value could only be a
-- false claim. It is replaced below rather than merely dropped: the mode-conditional constraint
-- keeps the same guarantee for RECORD_ONLY -- the column default and the launch mode -- while
-- letting a gated LIVE collection record the payment it actually confirmed. Writing a collected
-- row now requires all three of mode = LIVE, the collected status, and the processor reference.
ALTER TABLE "invoices"
  DROP CONSTRAINT "invoices_collection_uncollected";

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_collection_mode_known"
    CHECK ("collection_mode" IN ('RECORD_ONLY', 'LIVE')),
  ADD CONSTRAINT "invoices_collection_status_known"
    CHECK ("collection_status" IN ('uncollected', 'collected')),
  -- A collected invoice must carry the reference that proves it, and must stand in LIVE: the mode
  -- column describes where the invoice is now, so `RECORD_ONLY` always means no money was
  -- requested against it. Confirming a collection moves both columns together.
  ADD CONSTRAINT "invoices_collected_requires_reference"
    CHECK ("collection_status" <> 'collected' OR "collection_reference" IS NOT NULL),
  ADD CONSTRAINT "invoices_record_only_stays_uncollected"
    CHECK ("collection_mode" <> 'RECORD_ONLY' OR "collection_status" = 'uncollected');

-- ---------------------------------------------------------------------------
-- Per-organization API call counters.
-- ---------------------------------------------------------------------------

CREATE TABLE "usage_counters" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "period_start" TIMESTAMPTZ(3) NOT NULL,
  "endpoint" TEXT NOT NULL,
  -- Decimal(38,0) rather than INTEGER: the count is multiplied by a per-call price, and an
  -- enterprise month must not overflow or round on the way to an invoice.
  "call_count" DECIMAL(38, 0) NOT NULL DEFAULT 0,
  "first_call_at" TIMESTAMPTZ(3) NOT NULL,
  "last_call_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usage_counters_endpoint_known" CHECK (
    "endpoint" IN ('quote', 'route_search', 'compliance', 'liquidity', 'settlement_status', 'reconciliation')
  ),
  CONSTRAINT "usage_counters_call_count_non_negative" CHECK ("call_count" >= 0)
);

ALTER TABLE "usage_counters"
  ADD CONSTRAINT "usage_counters_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;

-- The unique key is what lets the meter be a single upsert on the request path rather than a
-- read-modify-write that loses concurrent increments.
CREATE UNIQUE INDEX "usage_counters_organization_id_period_start_endpoint_key"
  ON "usage_counters" ("organization_id", "period_start", "endpoint");
CREATE INDEX "usage_counters_period_start_idx" ON "usage_counters" ("period_start");

-- ---------------------------------------------------------------------------
-- Subscription tier assignment. No row means the free tier.
-- ---------------------------------------------------------------------------

CREATE TABLE "organization_subscriptions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "currency" VARCHAR(16) NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "cancelled_at" TIMESTAMPTZ(3),
  -- A negotiated per-decision fee is a constant in minor units, never a rate (§18.2).
  "flat_decision_fee_minor_units" DECIMAL(38, 0),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_subscriptions_tier_known"
    CHECK ("tier" IN ('free', 'starter', 'pro', 'enterprise')),
  CONSTRAINT "organization_subscriptions_flat_fee_non_negative"
    CHECK ("flat_decision_fee_minor_units" IS NULL OR "flat_decision_fee_minor_units" >= 0)
);

ALTER TABLE "organization_subscriptions"
  ADD CONSTRAINT "organization_subscriptions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "organization_subscriptions_organization_id_key"
  ON "organization_subscriptions" ("organization_id");

-- ---------------------------------------------------------------------------
-- Collection attempts.
-- ---------------------------------------------------------------------------

CREATE TABLE "collection_attempts" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "currency" VARCHAR(16) NOT NULL,
  "amount_minor_units" DECIMAL(38, 0) NOT NULL,
  -- The processor's own reference. Never a card number, bank account, or any other credential:
  -- collection uses the processor's tokenization flow and this table has nowhere to put one.
  "processor_reference" TEXT,
  "processor_kind" TEXT,
  "confirmation_source" TEXT,
  "failure_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3),

  CONSTRAINT "collection_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "collection_attempts_mode_known" CHECK ("mode" IN ('RECORD_ONLY', 'LIVE')),
  CONSTRAINT "collection_attempts_status_known"
    CHECK ("status" IN ('recorded', 'pending', 'succeeded', 'failed')),
  CONSTRAINT "collection_attempts_confirmation_source_known" CHECK (
    "confirmation_source" IS NULL
    OR "confirmation_source" IN ('processor_webhook', 'processor_sync_confirmed', 'operator_manual')
  ),
  CONSTRAINT "collection_attempts_amount_non_negative" CHECK ("amount_minor_units" >= 0),
  -- A success must be substantiated: a reference, a named source, and a confirmation time. This
  -- is the database half of "the API call didn't error is not collection".
  CONSTRAINT "collection_attempts_success_requires_reference" CHECK (
    "status" <> 'succeeded'
    OR ("processor_reference" IS NOT NULL AND "confirmation_source" IS NOT NULL AND "confirmed_at" IS NOT NULL)
  ),
  -- RECORD_ONLY never contacts a processor, so it can neither succeed nor produce a reference.
  CONSTRAINT "collection_attempts_record_only_never_succeeds" CHECK (
    "mode" <> 'RECORD_ONLY' OR ("status" = 'recorded' AND "processor_reference" IS NULL)
  )
);

ALTER TABLE "collection_attempts"
  ADD CONSTRAINT "collection_attempts_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices" ("id") ON DELETE CASCADE;

-- One attempt per invoice collection. A retry resolves to this row rather than a second charge.
CREATE UNIQUE INDEX "collection_attempts_idempotency_key_key"
  ON "collection_attempts" ("idempotency_key");
CREATE INDEX "collection_attempts_invoice_id_idx" ON "collection_attempts" ("invoice_id");
CREATE INDEX "collection_attempts_organization_id_created_at_idx"
  ON "collection_attempts" ("organization_id", "created_at" DESC);
