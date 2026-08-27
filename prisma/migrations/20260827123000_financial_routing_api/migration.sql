-- Organization API key scopes/expiry, and execution intents (recorded route choice, never a payment).

ALTER TABLE "api_keys" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "api_keys" ADD COLUMN "expires_at" TIMESTAMPTZ(3);

UPDATE "api_keys"
SET "scopes" = ARRAY['quote:read', 'route:read']::TEXT[]
WHERE cardinality("scopes") = 0;

ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_scopes_known"
  CHECK ("scopes" <@ ARRAY['quote:read', 'route:read', 'transaction:create']::TEXT[]);

CREATE TABLE "execution_intents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "source_asset" VARCHAR(16) NOT NULL,
    "destination_asset" VARCHAR(16) NOT NULL,
    "amount_minor_units" DECIMAL(38,0) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'recorded',
    "executable" BOOLEAN NOT NULL DEFAULT false,
    "submitted" BOOLEAN NOT NULL DEFAULT false,
    "quote_expires_at" TIMESTAMPTZ(3),
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_intents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "execution_intents_organization_id_created_at_idx"
  ON "execution_intents"("organization_id", "created_at");

ALTER TABLE "execution_intents"
  ADD CONSTRAINT "execution_intents_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "execution_intents"
  ADD CONSTRAINT "execution_intents_status_recorded"
  CHECK ("status" = 'recorded');

ALTER TABLE "execution_intents"
  ADD CONSTRAINT "execution_intents_not_executable"
  CHECK ("executable" = false);

ALTER TABLE "execution_intents"
  ADD CONSTRAINT "execution_intents_not_submitted"
  CHECK ("submitted" = false);

ALTER TABLE "execution_intents"
  ADD CONSTRAINT "execution_intents_amount_positive"
  CHECK ("amount_minor_units" > 0);

ALTER TABLE "execution_intents"
  ADD CONSTRAINT "execution_intents_cross_asset"
  CHECK ("source_asset" <> "destination_asset");
