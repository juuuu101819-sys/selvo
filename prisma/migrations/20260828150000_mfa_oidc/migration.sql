-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "require_mfa_for_privileged_roles" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "totp_secret_ciphertext" TEXT;
ALTER TABLE "users" ADD COLUMN "pending_totp_secret_ciphertext" TEXT;
ALTER TABLE "users" ADD COLUMN "mfa_enabled_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_challenges" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_oidc_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_ciphertext" TEXT,
    "redirect_uri" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_oidc_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_authorization_states" (
    "id" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "nonce_ciphertext" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oidc_authorization_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "mfa_recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_challenges_token_hash_key" ON "mfa_challenges"("token_hash");

-- CreateIndex
CREATE INDEX "mfa_challenges_user_id_idx" ON "mfa_challenges"("user_id");

-- CreateIndex
CREATE INDEX "mfa_challenges_expires_at_idx" ON "mfa_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "organization_oidc_connections_organization_id_key" ON "organization_oidc_connections"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "oidc_authorization_states_state_hash_key" ON "oidc_authorization_states"("state_hash");

-- CreateIndex
CREATE INDEX "oidc_authorization_states_organization_id_idx" ON "oidc_authorization_states"("organization_id");

-- CreateIndex
CREATE INDEX "oidc_authorization_states_expires_at_idx" ON "oidc_authorization_states"("expires_at");

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_oidc_connections" ADD CONSTRAINT "organization_oidc_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oidc_authorization_states" ADD CONSTRAINT "oidc_authorization_states_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
