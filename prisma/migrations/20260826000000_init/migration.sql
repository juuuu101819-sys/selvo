-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "comparisons" (
    "comparison_id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "mode" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source_currency" VARCHAR(3) NOT NULL,
    "target_currency" VARCHAR(3) NOT NULL,
    "amount_minor_units" DECIMAL(38,0) NOT NULL,
    "idempotency_key" TEXT,
    "snapshot" JSONB NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "comparisons_pkey" PRIMARY KEY ("comparison_id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor" TEXT NOT NULL,
    "request_id" TEXT,
    "comparison_id" TEXT,
    "provider_id" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "organisations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organisation_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "organisation_id" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comparisons_sequence_key" ON "comparisons"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "comparisons_idempotency_key_key" ON "comparisons"("idempotency_key");

-- CreateIndex
CREATE INDEX "comparisons_created_at_sequence_idx" ON "comparisons"("created_at" DESC, "sequence" DESC);

-- CreateIndex
CREATE INDEX "comparisons_fingerprint_idx" ON "comparisons"("fingerprint");

-- CreateIndex
CREATE INDEX "comparisons_source_currency_target_currency_created_at_idx" ON "comparisons"("source_currency", "target_currency", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_comparison_id_occurred_at_idx" ON "audit_events"("comparison_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_type_occurred_at_idx" ON "audit_events"("type", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "organisations_slug_key" ON "organisations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organisation_id_idx" ON "users"("organisation_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_prefix_key" ON "api_keys"("key_prefix");

-- CreateIndex
CREATE INDEX "api_keys_organisation_id_idx" ON "api_keys"("organisation_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Invariants Prisma cannot express in the schema language, added by hand and
-- covered by a test so they are not lost on a future `migrate diff`.
-- ---------------------------------------------------------------------------

-- A comparison is always a genuine cross-currency corridor for a positive amount.
ALTER TABLE "comparisons"
    ADD CONSTRAINT "comparisons_mode_check" CHECK ("mode" IN ('sandbox', 'production')),
    ADD CONSTRAINT "comparisons_corridor_differs" CHECK ("source_currency" <> "target_currency"),
    ADD CONSTRAINT "comparisons_amount_positive" CHECK ("amount_minor_units" > 0);

-- The audit trail is immutable. Enforced in the database as well as in the repository API, so
-- neither an application defect nor an ad-hoc session can rewrite financial history.
CREATE OR REPLACE FUNCTION audit_events_reject_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON "audit_events";
CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE OR DELETE ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION audit_events_reject_mutation();
