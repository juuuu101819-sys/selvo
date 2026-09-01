-- Mandate ingestion: signed authorization records (AP2 / x402 / MPP).
-- Verification and storage only. No balances, wallets, private keys, or execution.

CREATE TYPE "MandateFormat" AS ENUM ('ap2_intent', 'ap2_cart', 'x402', 'mpp');
CREATE TYPE "MandateStatus" AS ENUM ('verified', 'revoked');

CREATE TABLE "mandates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "format" "MandateFormat" NOT NULL,
    "status" "MandateStatus" NOT NULL,
    "spend_cap_minor_units" DECIMAL(38,0) NOT NULL,
    "spend_cap_asset" VARCHAR(16) NOT NULL,
    "allowed_corridors" JSONB NOT NULL,
    "allowed_currencies" TEXT[] NOT NULL,
    "allowed_beneficiaries" TEXT[] NOT NULL,
    "issuer" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "bound_credential_prefix" TEXT,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_actor" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mandates_spend_cap_positive" CHECK ("spend_cap_minor_units" > 0)
);

CREATE INDEX "mandates_organization_id_agent_id_status_idx" ON "mandates"("organization_id", "agent_id", "status");
CREATE INDEX "mandates_organization_id_created_at_idx" ON "mandates"("organization_id", "created_at");

ALTER TABLE "mandates"
  ADD CONSTRAINT "mandates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mandates"
  ADD CONSTRAINT "mandates_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "mandate_x402_challenges" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mandate_x402_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mandate_x402_challenges_organization_id_agent_id_idx"
  ON "mandate_x402_challenges"("organization_id", "agent_id");
