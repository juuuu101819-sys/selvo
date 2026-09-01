-- Execution-partner sandbox instructions. Partner settles to the beneficiary.
-- Meridian stores hashes only. No balances, wallets, private keys, or PII.

CREATE TYPE "PartnerInstructionStatus" AS ENUM ('accepted', 'settling', 'partial', 'settled', 'failed');

CREATE TABLE "partner_instructions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "quoted_provider_id" TEXT NOT NULL,
    "status" "PartnerInstructionStatus" NOT NULL,
    "source_asset" VARCHAR(16) NOT NULL,
    "destination_asset" VARCHAR(16) NOT NULL,
    "amount_minor_units" DECIMAL(38,0) NOT NULL,
    "filled_minor_units" DECIMAL(38,0) NOT NULL,
    "instruction_hash" TEXT NOT NULL,
    "signature_hash" TEXT NOT NULL,
    "failure_code" TEXT,
    "sandbox_scenario" VARCHAR(32) NOT NULL,
    "failover_from" TEXT[] NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_instructions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "partner_instructions_amounts_non_negative" CHECK ("amount_minor_units" >= 0 AND "filled_minor_units" >= 0)
);

CREATE INDEX "partner_instructions_organization_id_created_at_idx"
  ON "partner_instructions"("organization_id", "created_at");

ALTER TABLE "partner_instructions"
  ADD CONSTRAINT "partner_instructions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
