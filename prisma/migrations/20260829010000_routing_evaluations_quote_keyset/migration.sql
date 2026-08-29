-- PA-M10: persist MultiRailRouter ranking snapshots for /routes and /quote replay.
-- PA-M07: keyset index on dashboard quotes (quoted_at, id).

CREATE TABLE "routing_evaluations" (
    "routing_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "organization_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "ranked_route_ids" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "routing_evaluations_pkey" PRIMARY KEY ("routing_id")
);

CREATE INDEX "routing_evaluations_fingerprint_idx" ON "routing_evaluations"("fingerprint");
CREATE INDEX "routing_evaluations_organization_id_created_at_idx" ON "routing_evaluations"("organization_id", "created_at" DESC);

ALTER TABLE "routing_evaluations" ADD CONSTRAINT "routing_evaluations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "quotes_organization_id_quoted_at_id_idx" ON "quotes"("organization_id", "quoted_at" DESC, "id");
