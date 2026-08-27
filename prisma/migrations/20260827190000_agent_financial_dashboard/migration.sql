-- Phase 18: default route preference on an agent payment policy. Null means the engine default.
-- No custody, keys or wallets.

ALTER TABLE "payment_policies"
  ADD COLUMN "preferred_route_preference" TEXT;
