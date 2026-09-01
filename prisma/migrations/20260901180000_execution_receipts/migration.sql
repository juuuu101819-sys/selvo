-- Receipt timestamps on orchestrated executions, plus Ed25519-signed receipt rows.
-- Private keys stay in provider_credentials (vault). Receipts store public key + signature + hashes.

ALTER TABLE "orchestrated_executions"
  ADD COLUMN "quoted_at" TIMESTAMPTZ(3),
  ADD COLUMN "dispatched_at" TIMESTAMPTZ(3),
  ADD COLUMN "settled_at" TIMESTAMPTZ(3),
  ADD COLUMN "receipt_id" TEXT;

CREATE TABLE "execution_receipts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "payload_canonical" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "public_key_pem" TEXT NOT NULL,
    "public_key_fingerprint" TEXT NOT NULL,
    "funds_moved" BOOLEAN NOT NULL DEFAULT false,
    "custody" BOOLEAN NOT NULL DEFAULT false,
    "meridian_keys_used" BOOLEAN NOT NULL DEFAULT false,
    "sandbox" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "execution_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "execution_receipts_non_custodial" CHECK (
      "funds_moved" = false
      AND "custody" = false
      AND "meridian_keys_used" = false
      AND "sandbox" = true
    )
);

CREATE UNIQUE INDEX "execution_receipts_execution_id_key" ON "execution_receipts"("execution_id");

CREATE INDEX "execution_receipts_organization_id_created_at_idx"
  ON "execution_receipts"("organization_id", "created_at");

ALTER TABLE "execution_receipts"
  ADD CONSTRAINT "execution_receipts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
