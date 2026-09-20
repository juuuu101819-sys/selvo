-- Signed settlement instructions: Pattern A, generate-and-return (spec sections 2 and 15).
--
-- Before this table, `execution_intents` recorded that a customer had picked a route and returned
-- an id. The customer could not act on it, so the non-custodial boundary held only because the
-- feature was inert. This table holds the artifact that replaces that: a canonical payload Meridian
-- signed and handed back, which the customer takes to a provider they already have a relationship
-- with.
--
-- The constraints below are the boundary written down. The interesting ones are negative: the table
-- can record that an instruction was produced, and that the customer signed it, and nothing else.
-- There is no status column to advance, no dispatched_at to stamp, and `meridian_transmitted` is
-- pinned false, so a future writer cannot record a transmission even by mistake -- it would have to
-- drop a named constraint first, which is a reviewable act rather than a silent one.

CREATE TABLE "settlement_instructions" (
  "id"                           TEXT PRIMARY KEY,
  "organization_id"              TEXT NOT NULL,
  "execution_intent_id"          TEXT NOT NULL,
  "routing_id"                   TEXT NOT NULL,
  "route_id"                     TEXT NOT NULL,
  "boundary_mode"                TEXT NOT NULL,
  "origin_env"                   TEXT NOT NULL,
  "payload_canonical"            TEXT NOT NULL,
  "payload_hash"                 TEXT NOT NULL,
  "signature"                    TEXT NOT NULL,
  "signing_key_id"               TEXT NOT NULL,
  "customer_signature"           TEXT,
  "customer_signature_algorithm" TEXT,
  "customer_key_id"              TEXT,
  "customer_signed_at"           TIMESTAMPTZ(3),
  "expires_at"                   TIMESTAMPTZ(3) NOT NULL,
  "meridian_transmitted"         BOOLEAN NOT NULL DEFAULT false,
  "funds_moved"                  BOOLEAN NOT NULL DEFAULT false,
  "custody"                      BOOLEAN NOT NULL DEFAULT false,
  "created_at"                   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

  CONSTRAINT "settlement_instructions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE,
  CONSTRAINT "settlement_instructions_execution_intent_id_fkey"
    FOREIGN KEY ("execution_intent_id") REFERENCES "execution_intents" ("id") ON DELETE CASCADE,

  -- Only the two boundary modes exist. Pattern C -- Meridian dispatching -- is not a value here,
  -- so no row can describe Meridian as the sender. The TypeScript union says the same thing; this
  -- says it where a hand-written UPDATE also has to obey it.
  CONSTRAINT "settlement_instructions_boundary_mode_known"
    CHECK ("boundary_mode" IN ('RETURN_TO_CUSTOMER', 'PARTNER_EXECUTES')),

  -- The invariant the whole phase exists to keep. Generating and returning an artifact is the only
  -- thing Meridian does, so the transmitted flag has exactly one legal value.
  CONSTRAINT "settlement_instructions_never_transmitted"
    CHECK ("meridian_transmitted" = false),
  CONSTRAINT "settlement_instructions_non_custodial"
    CHECK ("funds_moved" = false AND "custody" = false),

  CONSTRAINT "settlement_instructions_origin_env_known"
    CHECK ("origin_env" IN ('DEMO', 'SIMULATION', 'PARTNER_SANDBOX', 'PRODUCTION')),

  -- A counter-signature is all four columns or none of them. A signature with no algorithm cannot
  -- be verified by anyone, and a timestamp with no signature is a claim the customer approved
  -- something with nothing to back it.
  CONSTRAINT "settlement_instructions_customer_signature_complete"
    CHECK (
      (
        "customer_signature" IS NULL
        AND "customer_signature_algorithm" IS NULL
        AND "customer_key_id" IS NULL
        AND "customer_signed_at" IS NULL
      )
      OR (
        "customer_signature" IS NOT NULL
        AND "customer_signature_algorithm" IS NOT NULL
        AND "customer_key_id" IS NOT NULL
        AND "customer_signed_at" IS NOT NULL
      )
    ),
  CONSTRAINT "settlement_instructions_customer_signature_algorithm_known"
    CHECK (
      "customer_signature_algorithm" IS NULL
      OR "customer_signature_algorithm" IN ('Ed25519', 'ECDSA_P256_SHA256')
    ),

  -- An instruction that expires before it is created cannot be acted on and can only be a clock or
  -- arithmetic error upstream.
  CONSTRAINT "settlement_instructions_expiry_after_creation"
    CHECK ("expires_at" > "created_at"),

  -- Canonical bytes and their hash travel together: a verifier re-derives the hash, so a row with
  -- one and not the other is unusable.
  CONSTRAINT "settlement_instructions_signed_material_present"
    CHECK (
      length("payload_canonical") > 0
      AND length("payload_hash") = 64
      AND length("signature") > 0
      AND length("signing_key_id") > 0
    )
);

CREATE INDEX "settlement_instructions_organization_id_created_at_idx"
  ON "settlement_instructions" ("organization_id", "created_at");
CREATE INDEX "settlement_instructions_execution_intent_id_idx"
  ON "settlement_instructions" ("execution_intent_id");
