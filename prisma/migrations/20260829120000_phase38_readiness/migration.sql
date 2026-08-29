-- PHASE 38: operator kill switch, provider credential vault, execution-authorization flags.
-- POST /api/v1/executions remains 501. Flags are inert. No licensed provider is introduced.

ALTER TABLE "organizations"
  ADD COLUMN "execution_authorized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "execution_authorized_at" TIMESTAMPTZ(3),
  ADD COLUMN "execution_authorized_by_actor" TEXT,
  ADD COLUMN "execution_agreement_reference" TEXT;

ALTER TABLE "agents"
  ADD COLUMN "execution_authorized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "execution_authorized_at" TIMESTAMPTZ(3),
  ADD COLUMN "execution_authorized_by_actor" TEXT,
  ADD COLUMN "execution_agreement_reference" TEXT;

CREATE TABLE "provider_credentials" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "key_name" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provider_credentials_provider_id_key_name_key" UNIQUE ("provider_id", "key_name"),
    CONSTRAINT "provider_credentials_ciphertext_v1" CHECK ("ciphertext" LIKE 'v1$%')
);

CREATE INDEX "provider_credentials_provider_id_idx" ON "provider_credentials"("provider_id");

CREATE TABLE "routing_manual_overrides" (
    "id" TEXT NOT NULL,
    "target_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider_id" TEXT,
    "source_asset" VARCHAR(16),
    "target_asset" VARCHAR(16),
    "reason" TEXT NOT NULL,
    "engaged_at" TIMESTAMPTZ(3) NOT NULL,
    "engaged_by_actor" TEXT NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "released_by_actor" TEXT,
    "release_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_manual_overrides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routing_manual_overrides_kind_known" CHECK ("kind" IN ('provider', 'corridor')),
    CONSTRAINT "routing_manual_overrides_reason_present" CHECK (char_length(btrim("reason")) > 0),
    CONSTRAINT "routing_manual_overrides_target_shape" CHECK (
      ("kind" = 'provider' AND "provider_id" IS NOT NULL AND "source_asset" IS NULL AND "target_asset" IS NULL)
      OR ("kind" = 'corridor' AND "provider_id" IS NULL AND "source_asset" IS NOT NULL AND "target_asset" IS NOT NULL)
    )
);

CREATE INDEX "routing_manual_overrides_target_key_idx" ON "routing_manual_overrides"("target_key");

-- One active kill switch per target. Released rows stay for audit; a new engage may reuse the key.
CREATE UNIQUE INDEX "routing_manual_overrides_active_target_key"
  ON "routing_manual_overrides" ("target_key")
  WHERE "released_at" IS NULL;
