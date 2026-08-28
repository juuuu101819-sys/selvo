-- PA-L02: Prisma/Postgres enum for execution_intents.status (still CHECK-constrained to recorded).
-- Drop the TEXT CHECK first: after the type change it would compare enum = text and fail.
CREATE TYPE "ExecutionIntentStatus" AS ENUM ('recorded');

ALTER TABLE "execution_intents" DROP CONSTRAINT "execution_intents_status_recorded";

ALTER TABLE "execution_intents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "execution_intents"
  ALTER COLUMN "status" TYPE "ExecutionIntentStatus"
  USING ("status"::"ExecutionIntentStatus");
ALTER TABLE "execution_intents"
  ALTER COLUMN "status" SET DEFAULT 'recorded'::"ExecutionIntentStatus";

ALTER TABLE "execution_intents"
  ADD CONSTRAINT "execution_intents_status_recorded"
  CHECK ("status" = 'recorded'::"ExecutionIntentStatus");

-- PA-M08: composite indexes matching sumDailySpending filters (status + asset + timestamps).
CREATE INDEX "payment_intents_daily_spend_authorized_idx"
  ON "payment_intents"("organization_id", "agent_id", "source_asset", "status", "authorized_at");

CREATE INDEX "payment_intents_daily_spend_created_idx"
  ON "payment_intents"("organization_id", "agent_id", "source_asset", "status", "created_at");
