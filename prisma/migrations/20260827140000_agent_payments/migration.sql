-- AI agent payment infrastructure: agents, hashed credentials, external wallet references,
-- merchants, policies and payment intents. The platform never custodies a wallet or moves funds.

CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agents_organization_id_idx" ON "agents"("organization_id");

ALTER TABLE "agents"
  ADD CONSTRAINT "agents_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_credentials" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "agent_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_credentials_key_prefix_key" ON "agent_credentials"("key_prefix");
CREATE INDEX "agent_credentials_agent_id_idx" ON "agent_credentials"("agent_id");
CREATE INDEX "agent_credentials_organization_id_idx" ON "agent_credentials"("organization_id");

ALTER TABLE "agent_credentials"
  ADD CONSTRAINT "agent_credentials_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_credentials"
  ADD CONSTRAINT "agent_credentials_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_credentials"
  ADD CONSTRAINT "agent_credentials_scopes_known"
  CHECK ("scopes" <@ ARRAY['quote:read', 'route:read', 'transaction:create', 'payment:create', 'payment:quote', 'payment:authorize']::TEXT[]);

CREATE TABLE "agent_wallet_references" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "external_ref" TEXT NOT NULL,
    "controlled_by_platform" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_wallet_references_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_wallet_references_organization_id_agent_id_idx"
  ON "agent_wallet_references"("organization_id", "agent_id");

ALTER TABLE "agent_wallet_references"
  ADD CONSTRAINT "agent_wallet_references_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_wallet_references"
  ADD CONSTRAINT "agent_wallet_references_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_wallet_references"
  ADD CONSTRAINT "agent_wallet_references_not_custodied"
  CHECK ("controlled_by_platform" = false);

ALTER TABLE "agent_wallet_references"
  ADD CONSTRAINT "agent_wallet_references_kind_known"
  CHECK ("kind" IN ('external_account', 'external_wallet'));

CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "recipient_code" TEXT NOT NULL,
    "settlement_asset" VARCHAR(16) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merchants_organization_id_recipient_code_key"
  ON "merchants"("organization_id", "recipient_code");
CREATE INDEX "merchants_organization_id_idx" ON "merchants"("organization_id");

ALTER TABLE "merchants"
  ADD CONSTRAINT "merchants_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payment_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "max_transaction_amount_minor_units" DECIMAL(38,0) NOT NULL,
    "allowed_assets" TEXT[],
    "allowed_recipient_codes" TEXT[],
    "allowed_provider_ids" TEXT[],
    "max_fee_bps" DECIMAL(12,4) NOT NULL,
    "daily_spending_limit_minor_units" DECIMAL(38,0) NOT NULL,
    "daily_spending_asset" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_policies_organization_id_agent_id_key"
  ON "payment_policies"("organization_id", "agent_id");

ALTER TABLE "payment_policies"
  ADD CONSTRAINT "payment_policies_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_policies"
  ADD CONSTRAINT "payment_policies_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_policies"
  ADD CONSTRAINT "payment_policies_amounts_positive"
  CHECK (
    "max_transaction_amount_minor_units" > 0
    AND "daily_spending_limit_minor_units" > 0
    AND "max_fee_bps" >= 0
  );

CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "source_asset" VARCHAR(16) NOT NULL,
    "destination_asset" VARCHAR(16) NOT NULL,
    "amount_minor_units" DECIMAL(38,0) NOT NULL,
    "recipient" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "route_preference" TEXT,
    "max_fee_bps" DECIMAL(12,4),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "payload_fingerprint" TEXT NOT NULL,
    "quoted_routes" JSONB NOT NULL DEFAULT '[]'::JSONB,
    "quote_expires_at" TIMESTAMPTZ(3),
    "selected_route_id" TEXT,
    "authorized_at" TIMESTAMPTZ(3),
    "simulated_at" TIMESTAMPTZ(3),
    "simulation" JSONB,
    "failure_reason" TEXT,
    "funds_moved" BOOLEAN NOT NULL DEFAULT false,
    "custody" BOOLEAN NOT NULL DEFAULT false,
    "real_execution" BOOLEAN NOT NULL DEFAULT false,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_intents_organization_id_created_at_idx"
  ON "payment_intents"("organization_id", "created_at");
CREATE INDEX "payment_intents_organization_id_agent_id_created_at_idx"
  ON "payment_intents"("organization_id", "agent_id", "created_at");

CREATE UNIQUE INDEX "payment_intents_org_agent_idempotency_key"
  ON "payment_intents"("organization_id", "agent_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_status_known"
  CHECK ("status" IN (
    'CREATED', 'QUOTING', 'QUOTED', 'AUTHORIZED', 'ROUTED',
    'EXECUTION_PENDING', 'COMPLETED', 'FAILED', 'EXPIRED'
  ));

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_not_funds_moved"
  CHECK ("funds_moved" = false);

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_not_custody"
  CHECK ("custody" = false);

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_not_real_execution"
  CHECK ("real_execution" = false);

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_amount_positive"
  CHECK ("amount_minor_units" > 0);

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_cross_asset"
  CHECK ("source_asset" <> "destination_asset");
