import {
  ANONYMOUS_PRINCIPAL,
  type AuthenticationAttempt,
  type Authenticator,
  type Principal,
} from '@meridian/core';

const MAX_ACTOR_LENGTH = 128;

/**
 * The Phase 1 authenticator: accepts unauthenticated callers, and refuses to pretend.
 *
 * Any request that presents a credential is rejected rather than quietly accepted as anonymous.
 * That matters more than it looks: a client that sends a bearer token and receives `200` would
 * reasonably conclude it is authenticated and that its data is scoped to its organisation, when
 * neither is true. Failing closed on a credential this deployment cannot verify is the honest
 * behaviour, and it means switching on real authentication later cannot silently downgrade anyone.
 *
 * Replaced in Phase 2 by an authenticator that verifies API keys and session tokens against the
 * Organisation, User and ApiKey tables the schema already defines.
 */
export class AnonymousAuthenticator implements Authenticator {
  readonly scheme = 'anonymous';
  readonly enforcing = false;

  authenticate(attempt: AuthenticationAttempt): Promise<Principal | null> {
    if (attempt.authorization !== null || attempt.apiKey !== null) {
      return Promise.resolve(null);
    }

    const declared = attempt.declaredActor?.trim() ?? '';
    if (declared === '') {
      return Promise.resolve(ANONYMOUS_PRINCIPAL);
    }

    return Promise.resolve({
      ...ANONYMOUS_PRINCIPAL,
      // Bounded so an unauthenticated header cannot be used to bloat the audit log, and flagged
      // unverified so nothing downstream mistakes it for an identity.
      actor: declared.slice(0, MAX_ACTOR_LENGTH),
      displayName: declared.slice(0, MAX_ACTOR_LENGTH),
      verified: false,
    });
  }
}
