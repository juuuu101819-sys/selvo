-- PA-H13: payment-intent statuses that read as licensed-rail settlement are renamed.
-- AUTHORIZED → POLICY_APPROVED (policy engine, not a funds hold)
-- EXECUTION_PENDING → SIMULATION_PENDING (sandbox only)
-- COMPLETED → SIMULATION_COMPLETED (simulator finished; funds_moved stays false)
-- There is still no SETTLEMENT_CONFIRMED value. Live execution remains 501.

ALTER TABLE "payment_intents" DROP CONSTRAINT IF EXISTS "payment_intents_status_known";

UPDATE "payment_intents" SET "status" = 'POLICY_APPROVED' WHERE "status" = 'AUTHORIZED';
UPDATE "payment_intents" SET "status" = 'SIMULATION_PENDING' WHERE "status" = 'EXECUTION_PENDING';
UPDATE "payment_intents" SET "status" = 'SIMULATION_COMPLETED' WHERE "status" = 'COMPLETED';

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "payment_intents_status_known"
  CHECK ("status" IN (
    'CREATED', 'QUOTING', 'QUOTED', 'ROUTED', 'POLICY_APPROVED',
    'SIMULATION_PENDING', 'SIMULATION_COMPLETED', 'FAILED', 'EXPIRED'
  ));
