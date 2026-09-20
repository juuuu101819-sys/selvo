-- Admit `mandate:verify` on agent credentials.
--
-- `agent_credentials_scopes_known` was written before mandate ingestion existed, so it lists the
-- six scopes of that era. The mandate phase added `mandate:verify` to `DEFAULT_AGENT_SCOPES` --
-- the exact set every `mag_` credential is issued with -- without widening the constraint. The
-- result is that no agent credential can be stored in PostgreSQL at all: `prisma db seed` and
-- `POST /agents/:id/credentials` both fail with a check-constraint violation. The in-memory
-- driver has no constraint, which is why the unit suite never saw it.
--
-- The allow-list is the storable set, not the issued set: it stays deliberately narrower than
-- `API_SCOPES` so an agent credential can never hold `agent_policy:write` (widen its own policy)
-- or `mandate:revoke` (cancel the mandate authorizing it). `AGENT_CREDENTIAL_SCOPES` in
-- `api-scope.ts` is the same list, and `api-scope.test.ts` fails if the two drift.

ALTER TABLE "agent_credentials"
  DROP CONSTRAINT "agent_credentials_scopes_known";

ALTER TABLE "agent_credentials"
  ADD CONSTRAINT "agent_credentials_scopes_known"
  CHECK (
    "scopes" <@ ARRAY[
      'quote:read',
      'route:read',
      'transaction:create',
      'payment:create',
      'payment:quote',
      'payment:authorize',
      'mandate:verify'
    ]::TEXT[]
  );
