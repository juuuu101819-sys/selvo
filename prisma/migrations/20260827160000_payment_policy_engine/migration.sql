-- Phase 16: non-custodial payment policy engine.
-- Empty allow-lists remain none (fail closed). New route-quality constraints.

ALTER TABLE "payment_policies"
  ADD COLUMN "allowed_chain_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "allowed_country_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "max_slippage_bps" DECIMAL(12, 4) NOT NULL DEFAULT 50,
  ADD COLUMN "min_route_score" DECIMAL(12, 4) NOT NULL DEFAULT 0,
  ADD COLUMN "min_liquidity_headroom" DECIMAL(12, 4) NOT NULL DEFAULT 0;
