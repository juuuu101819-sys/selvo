-- Sandbox execution orchestration. Partner settles; Meridian stores hashes only.
-- Non-custodial CHECKs: funds_moved, custody, transfer_signed, meridian_keys_used stay false.

CREATE TYPE "OrchestratedExecutionStatus" AS ENUM (
  'CREATED',
  'ROUTED',
  'COMPLIANCE_PASSED',
  'COMPLIANCE_REVIEW',
  'BLOCKED',
  'EXPIRED',
  'DISPATCHED',
  'SETTLING',
  'SETTLED',
  'FAILED'
);

CREATE TABLE "orchestrated_executions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "mandate_id" TEXT NOT NULL,
    "routing_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "partner_id" TEXT,
    "partner_instruction_id" TEXT,
    "status" "OrchestratedExecutionStatus" NOT NULL,
    "source_asset" VARCHAR(16) NOT NULL,
    "destination_asset" VARCHAR(16) NOT NULL,
    "amount_minor_units" DECIMAL(38,0) NOT NULL,
    "filled_minor_units" DECIMAL(38,0) NOT NULL,
    "quote_expires_at" TIMESTAMPTZ(3),
    "beneficiary_ref" VARCHAR(80) NOT NULL,
    "idempotency_key" TEXT,
    "payload_fingerprint" TEXT NOT NULL,
    "failure_code" TEXT,
    "blocked_reason" TEXT,
    "daily_limit_reserved" BOOLEAN NOT NULL DEFAULT false,
    "instruction_hash" TEXT,
    "signature_hash" TEXT,
    "instruction_signature_kind" TEXT,
    "transfer_signed" BOOLEAN NOT NULL DEFAULT false,
    "funds_moved" BOOLEAN NOT NULL DEFAULT false,
    "custody" BOOLEAN NOT NULL DEFAULT false,
    "meridian_keys_used" BOOLEAN NOT NULL DEFAULT false,
    "sandbox" BOOLEAN NOT NULL DEFAULT true,
    "failover_from" TEXT[] NOT NULL,
    "monetization_event_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orchestrated_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orchestrated_executions_amounts_non_negative" CHECK ("amount_minor_units" >= 0 AND "filled_minor_units" >= 0),
    CONSTRAINT "orchestrated_executions_non_custodial" CHECK (
      "funds_moved" = false
      AND "custody" = false
      AND "transfer_signed" = false
      AND "meridian_keys_used" = false
      AND "sandbox" = true
    )
);

CREATE UNIQUE INDEX "orchestrated_executions_organization_id_idempotency_key_key"
  ON "orchestrated_executions"("organization_id", "idempotency_key");

CREATE INDEX "orchestrated_executions_organization_id_created_at_idx"
  ON "orchestrated_executions"("organization_id", "created_at");

CREATE INDEX "orchestrated_executions_organization_id_agent_id_created_at_idx"
  ON "orchestrated_executions"("organization_id", "agent_id", "created_at");

ALTER TABLE "orchestrated_executions"
  ADD CONSTRAINT "orchestrated_executions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
