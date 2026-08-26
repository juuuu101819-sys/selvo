-- Meridian schema, revision 0001.
--
-- Design notes:
--   * Monetary amounts are stored as NUMERIC(38, 0) counts of minor units, never as a float or
--     money type. The node driver returns NUMERIC as a string, which is exactly the form the
--     application's Money type parses.
--   * The comparison snapshot and the serialised result are both persisted. The snapshot is what
--     makes a calculation reproducible; the result is what the API replays to a client.
--   * audit_events is append-only, enforced by a trigger rather than by convention, so an
--     application bug or an ad-hoc session cannot rewrite the financial audit trail.

BEGIN;

CREATE TABLE IF NOT EXISTS comparisons (
    comparison_id      TEXT PRIMARY KEY,
    -- Breaks ties when two comparisons share a created_at, so "most recent first" is a total
    -- order rather than an arbitrary one at millisecond resolution.
    sequence           BIGSERIAL      NOT NULL,
    created_at         TIMESTAMPTZ    NOT NULL,
    mode               TEXT           NOT NULL CHECK (mode IN ('sandbox', 'production')),
    engine_version     TEXT           NOT NULL,
    fingerprint        TEXT           NOT NULL,
    source_currency    CHAR(3)        NOT NULL,
    target_currency    CHAR(3)        NOT NULL,
    amount_minor_units NUMERIC(38, 0) NOT NULL CHECK (amount_minor_units > 0),
    idempotency_key    TEXT UNIQUE,
    snapshot           JSONB          NOT NULL,
    result             JSONB          NOT NULL,
    CONSTRAINT comparisons_corridor_differs CHECK (source_currency <> target_currency)
);

CREATE INDEX IF NOT EXISTS comparisons_created_at_idx
    ON comparisons (created_at DESC, sequence DESC);
CREATE INDEX IF NOT EXISTS comparisons_fingerprint_idx ON comparisons (fingerprint);
CREATE INDEX IF NOT EXISTS comparisons_corridor_idx
    ON comparisons (source_currency, target_currency, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
    event_id      TEXT PRIMARY KEY,
    type          TEXT        NOT NULL,
    occurred_at   TIMESTAMPTZ NOT NULL,
    actor         TEXT        NOT NULL,
    request_id    TEXT,
    comparison_id TEXT,
    provider_id   TEXT,
    payload       JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_occurred_at_idx ON audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_comparison_idx
    ON audit_events (comparison_id, occurred_at);
CREATE INDEX IF NOT EXISTS audit_events_type_idx ON audit_events (type, occurred_at DESC);

-- The audit trail is immutable. Inserts only.
CREATE OR REPLACE FUNCTION audit_events_reject_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_reject_mutation();

COMMIT;
