-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ProviderRail" AS ENUM ('bank_fx', 'payment_institution', 'stablecoin_settlement', 'liquidity_provider', 'dex_liquidity', 'treasury_product');

-- CreateEnum
CREATE TYPE "ProviderLicensing" AS ENUM ('unlicensed_sandbox', 'licensed_partner', 'internal_model');

-- CreateEnum
CREATE TYPE "PlatformMode" AS ENUM ('sandbox', 'production');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('active', 'suspended', 'retired');

-- CreateEnum
CREATE TYPE "CurrencyKind" AS ENUM ('fiat', 'stablecoin');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('owner', 'admin', 'member', 'viewer');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('invited', 'active', 'suspended', 'removed');

-- CreateEnum
CREATE TYPE "TransactionRequestStatus" AS ENUM ('draft', 'quoted', 'quotes_expired', 'quote_selected', 'cancelled');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('active', 'expired', 'superseded', 'withdrawn');

-- CreateEnum
CREATE TYPE "FeeSide" AS ENUM ('source', 'destination');

-- CreateEnum
CREATE TYPE "FeeKind" AS ENUM ('fixed', 'proportional');

-- CreateEnum
CREATE TYPE "FeeCharger" AS ENUM ('provider', 'platform', 'correspondent', 'network');

-- CreateEnum
CREATE TYPE "QuoteLegKind" AS ENUM ('fx_conversion', 'fiat_onramp', 'stablecoin_transfer', 'fiat_offramp', 'local_payout', 'correspondent_transfer');

-- CreateTable
CREATE TABLE "currencies" (
    "code" VARCHAR(3) NOT NULL,
    "numeric_code" VARCHAR(3),
    "name" TEXT NOT NULL,
    "exponent" INTEGER NOT NULL,
    "kind" "CurrencyKind" NOT NULL DEFAULT 'fiat',
    "symbol" VARCHAR(8),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "email_verified_at" TIMESTAMPTZ(3),
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "password_hash" TEXT,
    "password_set_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'member',
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "invited_at" TIMESTAMPTZ(3),
    "joined_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rail" "ProviderRail" NOT NULL,
    "licensing" "ProviderLicensing" NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "modes" "PlatformMode"[],
    "jurisdictions" TEXT[],
    "description" TEXT NOT NULL,
    "adapter_id" TEXT,
    "pricing_version" TEXT NOT NULL,
    "reliability_score" DECIMAL(5,4) NOT NULL,
    "quote_ttl_seconds" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_capabilities" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "source_currency" VARCHAR(3) NOT NULL,
    "target_currency" VARCHAR(3) NOT NULL,
    "min_amount_minor_units" DECIMAL(38,0) NOT NULL,
    "max_amount_minor_units" DECIMAL(38,0) NOT NULL,
    "spread_bps" DECIMAL(12,4) NOT NULL,
    "slippage_bps" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "settlement_p50_seconds" INTEGER NOT NULL,
    "settlement_p95_seconds" INTEGER NOT NULL,
    "business_days_only" BOOLEAN NOT NULL DEFAULT false,
    "cutoff_utc" VARCHAR(5),
    "intermediary_asset" VARCHAR(8),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "rail" "ProviderRail" NOT NULL,
    "source_currency" VARCHAR(3) NOT NULL,
    "target_currency" VARCHAR(3) NOT NULL,
    "leg_template" "QuoteLegKind"[],
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_pricing" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_currency" VARCHAR(3),
    "target_currency" VARCHAR(3),
    "rail" "ProviderRail",
    "provider_id" TEXT,
    "markup_bps" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "discount_bps" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "platform_fee_minor_units" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "fee_currency" VARCHAR(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT,
    "reference" TEXT,
    "source_currency" VARCHAR(3) NOT NULL,
    "target_currency" VARCHAR(3) NOT NULL,
    "amount_minor_units" DECIMAL(38,0) NOT NULL,
    "status" "TransactionRequestStatus" NOT NULL DEFAULT 'draft',
    "selected_quote_id" TEXT,
    "selected_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transaction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "transaction_request_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "route_id" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'active',
    "provider_quote_reference" TEXT,
    "quoted_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "source_currency" VARCHAR(3) NOT NULL,
    "target_currency" VARCHAR(3) NOT NULL,
    "amount_minor_units" DECIMAL(38,0) NOT NULL,
    "mid_market_rate" DECIMAL(38,18) NOT NULL,
    "exchange_rate" DECIMAL(38,18) NOT NULL,
    "effective_rate" DECIMAL(38,18) NOT NULL,
    "spread_bps" DECIMAL(12,4) NOT NULL,
    "slippage_bps" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "total_fee_minor_units" DECIMAL(38,0) NOT NULL,
    "total_cost_minor_units" DECIMAL(38,0) NOT NULL,
    "total_cost_bps" DECIMAL(12,4) NOT NULL,
    "estimated_receive_minor_units" DECIMAL(38,0) NOT NULL,
    "benchmark_receive_minor_units" DECIMAL(38,0) NOT NULL,
    "settlement_p50_seconds" INTEGER NOT NULL,
    "settlement_p95_seconds" INTEGER NOT NULL,
    "business_days_only" BOOLEAN NOT NULL DEFAULT false,
    "score" DECIMAL(6,2),
    "rank" INTEGER,
    "is_recommended" BOOLEAN NOT NULL DEFAULT false,
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "pricing_version" TEXT NOT NULL,
    "customer_pricing_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_legs" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "QuoteLegKind" NOT NULL,
    "from_currency" VARCHAR(3) NOT NULL,
    "to_currency" VARCHAR(3) NOT NULL,
    "from_amount_minor_units" DECIMAL(38,0) NOT NULL,
    "to_amount_minor_units" DECIMAL(38,0) NOT NULL,
    "rate" DECIMAL(38,18),
    "counterparty" TEXT,
    "estimated_seconds" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fees" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "side" "FeeSide" NOT NULL,
    "kind" "FeeKind" NOT NULL,
    "chargedBy" "FeeCharger" NOT NULL DEFAULT 'provider',
    "currency" VARCHAR(3) NOT NULL,
    "amount_minor_units" DECIMAL(38,0) NOT NULL,
    "rate_bps" DECIMAL(12,4),
    "was_capped" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparisons" (
    "comparison_id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "organization_id" TEXT,
    "transaction_request_id" TEXT,
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
CREATE TABLE "audit_logs" (
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "actor" TEXT NOT NULL,
    "organization_id" TEXT,
    "request_id" TEXT,
    "comparison_id" TEXT,
    "provider_id" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "currencies_is_active_idx" ON "currencies"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_prefix_key" ON "api_keys"("key_prefix");

-- CreateIndex
CREATE INDEX "api_keys_organization_id_idx" ON "api_keys"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "providers_slug_key" ON "providers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "providers_adapter_id_key" ON "providers"("adapter_id");

-- CreateIndex
CREATE INDEX "providers_rail_status_idx" ON "providers"("rail", "status");

-- CreateIndex
CREATE INDEX "providers_status_idx" ON "providers"("status");

-- CreateIndex
CREATE INDEX "provider_capabilities_source_currency_target_currency_is_ac_idx" ON "provider_capabilities"("source_currency", "target_currency", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "provider_capabilities_provider_id_source_currency_target_cu_key" ON "provider_capabilities"("provider_id", "source_currency", "target_currency");

-- CreateIndex
CREATE UNIQUE INDEX "routes_key_key" ON "routes"("key");

-- CreateIndex
CREATE INDEX "routes_source_currency_target_currency_status_idx" ON "routes"("source_currency", "target_currency", "status");

-- CreateIndex
CREATE UNIQUE INDEX "routes_provider_id_source_currency_target_currency_rail_key" ON "routes"("provider_id", "source_currency", "target_currency", "rail");

-- CreateIndex
CREATE INDEX "customer_pricing_organization_id_status_priority_idx" ON "customer_pricing"("organization_id", "status", "priority" DESC);

-- CreateIndex
CREATE INDEX "customer_pricing_organization_id_source_currency_target_cur_idx" ON "customer_pricing"("organization_id", "source_currency", "target_currency");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_requests_selected_quote_id_key" ON "transaction_requests"("selected_quote_id");

-- CreateIndex
CREATE INDEX "transaction_requests_organization_id_created_at_idx" ON "transaction_requests"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transaction_requests_status_created_at_idx" ON "transaction_requests"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transaction_requests_source_currency_target_currency_idx" ON "transaction_requests"("source_currency", "target_currency");

-- CreateIndex
CREATE INDEX "quotes_transaction_request_id_rank_idx" ON "quotes"("transaction_request_id", "rank");

-- CreateIndex
CREATE INDEX "quotes_organization_id_created_at_idx" ON "quotes"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quotes_provider_id_quoted_at_idx" ON "quotes"("provider_id", "quoted_at" DESC);

-- CreateIndex
CREATE INDEX "quotes_status_expires_at_idx" ON "quotes"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_transaction_request_id_provider_id_quoted_at_key" ON "quotes"("transaction_request_id", "provider_id", "quoted_at");

-- CreateIndex
CREATE UNIQUE INDEX "quote_legs_quote_id_sequence_key" ON "quote_legs"("quote_id", "sequence");

-- CreateIndex
CREATE INDEX "fees_quote_id_idx" ON "fees"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "fees_quote_id_code_side_key" ON "fees"("quote_id", "code", "side");

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
CREATE INDEX "comparisons_organization_id_created_at_idx" ON "comparisons"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_comparison_id_occurred_at_idx" ON "audit_logs"("comparison_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_type_occurred_at_idx" ON "audit_logs"("type", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_occurred_at_idx" ON "audit_logs"("organization_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_capabilities" ADD CONSTRAINT "provider_capabilities_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_capabilities" ADD CONSTRAINT "provider_capabilities_source_currency_fkey" FOREIGN KEY ("source_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_capabilities" ADD CONSTRAINT "provider_capabilities_target_currency_fkey" FOREIGN KEY ("target_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_source_currency_fkey" FOREIGN KEY ("source_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_target_currency_fkey" FOREIGN KEY ("target_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_pricing" ADD CONSTRAINT "customer_pricing_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_pricing" ADD CONSTRAINT "customer_pricing_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_pricing" ADD CONSTRAINT "customer_pricing_source_currency_fkey" FOREIGN KEY ("source_currency") REFERENCES "currencies"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_pricing" ADD CONSTRAINT "customer_pricing_target_currency_fkey" FOREIGN KEY ("target_currency") REFERENCES "currencies"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_pricing" ADD CONSTRAINT "customer_pricing_fee_currency_fkey" FOREIGN KEY ("fee_currency") REFERENCES "currencies"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_requests" ADD CONSTRAINT "transaction_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_requests" ADD CONSTRAINT "transaction_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_requests" ADD CONSTRAINT "transaction_requests_source_currency_fkey" FOREIGN KEY ("source_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_requests" ADD CONSTRAINT "transaction_requests_target_currency_fkey" FOREIGN KEY ("target_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_transaction_request_id_fkey" FOREIGN KEY ("transaction_request_id") REFERENCES "transaction_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_pricing_id_fkey" FOREIGN KEY ("customer_pricing_id") REFERENCES "customer_pricing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_source_currency_fkey" FOREIGN KEY ("source_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_target_currency_fkey" FOREIGN KEY ("target_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_legs" ADD CONSTRAINT "quote_legs_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_legs" ADD CONSTRAINT "quote_legs_from_currency_fkey" FOREIGN KEY ("from_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_legs" ADD CONSTRAINT "quote_legs_to_currency_fkey" FOREIGN KEY ("to_currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_transaction_request_id_fkey" FOREIGN KEY ("transaction_request_id") REFERENCES "transaction_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- Invariants Prisma cannot express in the schema language.
--
-- Added by hand and asserted by a test, because this is exactly the kind of
-- edit a future `prisma migrate diff` would not regenerate. Each one encodes a
-- rule that is cheap to enforce here and expensive to discover later from a
-- corrupted row.
-- ===========================================================================

-- Reference data: an exponent outside the plausible range would silently corrupt
-- every amount in that currency. ISO 4217 fiat tops out at 4 (CLF); stablecoins
-- are commonly 6 (USDC, USDT) and occasionally 18, so the bound depends on kind
-- rather than being loosened for everything.
ALTER TABLE "currencies"
    ADD CONSTRAINT "currencies_exponent_range" CHECK (
        ("kind" = 'fiat' AND "exponent" BETWEEN 0 AND 4)
        OR ("kind" = 'stablecoin' AND "exponent" BETWEEN 0 AND 18)
    );

-- A capability's bounds must be orderable, and a p95 cannot precede a p50.
ALTER TABLE "provider_capabilities"
    ADD CONSTRAINT "capability_amount_bounds" CHECK ("max_amount_minor_units" >= "min_amount_minor_units"),
    ADD CONSTRAINT "capability_amount_positive" CHECK ("min_amount_minor_units" >= 0),
    ADD CONSTRAINT "capability_settlement_order" CHECK ("settlement_p95_seconds" >= "settlement_p50_seconds"),
    ADD CONSTRAINT "capability_spread_non_negative" CHECK ("spread_bps" >= 0 AND "slippage_bps" >= 0),
    ADD CONSTRAINT "capability_corridor_differs" CHECK ("source_currency" <> "target_currency");

-- A request is always a genuine cross-currency corridor for a positive amount.
ALTER TABLE "transaction_requests"
    ADD CONSTRAINT "request_amount_positive" CHECK ("amount_minor_units" > 0),
    ADD CONSTRAINT "request_corridor_differs" CHECK ("source_currency" <> "target_currency");

-- Quote invariants. A rate of zero or below is not a price, a quote that expires
-- before it was issued is not a quote, and a negative payout is not a payout.
ALTER TABLE "quotes"
    ADD CONSTRAINT "quote_amount_positive" CHECK ("amount_minor_units" > 0),
    ADD CONSTRAINT "quote_corridor_differs" CHECK ("source_currency" <> "target_currency"),
    ADD CONSTRAINT "quote_rates_positive" CHECK ("mid_market_rate" > 0 AND "exchange_rate" > 0 AND "effective_rate" > 0),
    ADD CONSTRAINT "quote_expiry_after_quoted" CHECK ("expires_at" > "quoted_at"),
    ADD CONSTRAINT "quote_receive_non_negative" CHECK ("estimated_receive_minor_units" >= 0 AND "benchmark_receive_minor_units" >= 0),
    ADD CONSTRAINT "quote_fees_non_negative" CHECK ("total_fee_minor_units" >= 0),
    ADD CONSTRAINT "quote_slippage_non_negative" CHECK ("slippage_bps" >= 0),
    ADD CONSTRAINT "quote_score_range" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100)),
    ADD CONSTRAINT "quote_rank_positive" CHECK ("rank" IS NULL OR "rank" >= 1);

-- Legs must move a non-negative amount and be ordered from 1.
ALTER TABLE "quote_legs"
    ADD CONSTRAINT "leg_sequence_positive" CHECK ("sequence" >= 1),
    ADD CONSTRAINT "leg_amounts_non_negative" CHECK ("from_amount_minor_units" >= 0 AND "to_amount_minor_units" >= 0),
    ADD CONSTRAINT "leg_rate_positive" CHECK ("rate" IS NULL OR "rate" > 0);

-- A fee is a charge, never a rebate; a negative fee would flatter a route's cost.
ALTER TABLE "fees"
    ADD CONSTRAINT "fee_amount_non_negative" CHECK ("amount_minor_units" >= 0),
    ADD CONSTRAINT "fee_rate_non_negative" CHECK ("rate_bps" IS NULL OR "rate_bps" >= 0);

-- Commercial terms must be non-negative and cover a valid period.
ALTER TABLE "customer_pricing"
    ADD CONSTRAINT "pricing_non_negative" CHECK ("markup_bps" >= 0 AND "discount_bps" >= 0 AND "platform_fee_minor_units" >= 0),
    ADD CONSTRAINT "pricing_period_valid" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");

-- Comparison invariants, carried over from the previous schema revision.
ALTER TABLE "comparisons"
    ADD CONSTRAINT "comparisons_mode_check" CHECK ("mode" IN ('sandbox', 'production')),
    ADD CONSTRAINT "comparisons_corridor_differs" CHECK ("source_currency" <> "target_currency"),
    ADD CONSTRAINT "comparisons_amount_positive" CHECK ("amount_minor_units" > 0);

-- A quote may only be marked recommended once per request. Enforced as a partial
-- unique index because "at most one" is not expressible as a CHECK.
CREATE UNIQUE INDEX "quotes_one_recommendation_per_request"
    ON "quotes" ("transaction_request_id")
    WHERE "is_recommended";

-- The audit trail is immutable. Enforced in the database as well as in the
-- repository API, so neither an application defect nor an ad-hoc session can
-- rewrite financial history.
CREATE OR REPLACE FUNCTION audit_logs_reject_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_mutation ON "audit_logs";
CREATE TRIGGER audit_logs_no_mutation
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();
