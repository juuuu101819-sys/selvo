-- Per-corridor / per-partner / billing live-enablement with required legal sign-off.
-- enabled defaults false. A CHECK refuses enabled=true without complete sign-off metadata.
-- This table is not a funds ledger and holds no balances.

ALTER TABLE "routing_manual_overrides"
  ADD COLUMN "region" VARCHAR(8);

CREATE TABLE "live_enablements" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "region" VARCHAR(8) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" TEXT NOT NULL,
    "license_basis" TEXT NOT NULL,
    "approved_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "checklist_ref" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "disabled_at" TIMESTAMPTZ(3),
    "disabled_reason" TEXT,

    CONSTRAINT "live_enablements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "live_enablements_scope_check" CHECK ("scope" IN ('corridor', 'partner', 'billing')),
    CONSTRAINT "live_enablements_signoff_required" CHECK (
      "enabled" = false
      OR (
        length(btrim("approved_by")) > 0
        AND length(btrim("license_basis")) > 0
        AND length(btrim("checklist_ref")) > 0
      )
    ),
    CONSTRAINT "live_enablements_expiry_after_approval" CHECK ("expires_at" > "approved_at")
);

CREATE UNIQUE INDEX "live_enablements_scope_scope_key_key" ON "live_enablements"("scope", "scope_key");
CREATE INDEX "live_enablements_region_idx" ON "live_enablements"("region");
