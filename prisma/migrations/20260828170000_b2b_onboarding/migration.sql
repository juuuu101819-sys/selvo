-- PHASE 31: fail-closed KYB on organizations + sales-assisted invites.
-- Default kyb_status is unverified. No organization is eligible for licensed quotes until
-- verified AND an explicit customer_pricing row exists. POST /executions remains 501.

CREATE TYPE "KybStatus" AS ENUM ('unverified', 'pending', 'verified', 'rejected');

ALTER TABLE "organizations"
  ADD COLUMN "kyb_status" "KybStatus" NOT NULL DEFAULT 'unverified',
  ADD COLUMN "kyb_reason" TEXT,
  ADD COLUMN "kyb_reviewed_at" TIMESTAMPTZ(3),
  ADD COLUMN "kyb_reviewed_by_actor" TEXT;

CREATE TABLE "organization_invites" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "OrganizationRole" NOT NULL DEFAULT 'owner',
  "token_hash" TEXT NOT NULL,
  "token_prefix" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3),
  "created_by_actor" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_invites_token_hash_key" UNIQUE ("token_hash")
);

CREATE INDEX "organization_invites_organization_id_idx" ON "organization_invites"("organization_id");
CREATE INDEX "organization_invites_email_idx" ON "organization_invites"("email");

ALTER TABLE "organization_invites"
  ADD CONSTRAINT "organization_invites_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
