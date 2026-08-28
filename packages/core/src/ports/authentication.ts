import type { ApiScope } from '../domain/api-scope.js';
import type { EconomicActorKind } from '../domain/actor.js';

/**
 * Authentication architecture.
 *
 * Session tokens and API keys are verified against the identity store. Callers that present no
 * credential remain anonymous so the public comparison page keeps working. A credential that
 * cannot be verified is rejected rather than quietly treated as anonymous.
 *
 * Deliberately out of scope: SCIM. MFA (TOTP) and org-level OIDC are optional, off by default,
 * and issue the same PA-H02 session scopes as password login. See docs/AUTH.md.
 */

export const PRINCIPAL_KINDS = ['anonymous', 'user', 'service', 'agent'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

/**
 * Who is making a request.
 *
 * `organizationId` is the tenant boundary every query is scoped by. It is nullable only for
 * anonymous callers on the public comparison API. A null organization on a dashboard request is a
 * bug rather than a valid state.
 *
 * `economicActor` is who is speaking, distinct from tenancy: a human user and an API key both act
 * *for* an organization. An `agent` principal still acts *for* that organization and never
 * custodies funds on this platform.
 */
export interface Principal {
  readonly kind: PrincipalKind;
  /** Who is speaking. An `ai_agent` still acts for an organization, never as a holder of funds. */
  readonly economicActor: EconomicActorKind;
  readonly organizationId: string | null;
  /** User id or API key id, depending on `kind`. */
  readonly subjectId: string | null;
  readonly displayName: string;
  readonly roles: readonly string[];
  /** Rights granted to this caller. Empty for anonymous. Session users receive the scopes of their membership role. */
  readonly scopes: readonly ApiScope[];
  /**
   * Label recorded on audit events. Always derived from the verified session, API key, or agent
   * credential. Anonymous callers are always `"anonymous"` — client-supplied actor fields are ignored.
   */
  readonly actor: string;
  /** True when `actor` came from a verified credential rather than remaining anonymous. */
  readonly verified: boolean;
}

export const ANONYMOUS_PRINCIPAL: Principal = {
  kind: 'anonymous',
  economicActor: 'human',
  organizationId: null,
  subjectId: null,
  displayName: 'Anonymous',
  roles: [],
  scopes: [],
  actor: 'anonymous',
  verified: false,
};

/** The credential material an authenticator is given, extracted from the transport. */
export interface AuthenticationAttempt {
  /** Raw `Authorization` header, if present. */
  readonly authorization: string | null;
  /** Raw API key header, if present. */
  readonly apiKey: string | null;
  /**
   * Client-supplied actor hint (`X-Meridian-Actor`). Authenticators MUST ignore this for the
   * principal and for audit attribution (PA-M04).
   */
  readonly declaredActor: string | null;
}

export interface Authenticator {
  /** Human-readable scheme name, reported by the meta endpoint. */
  readonly scheme: string;
  /** True when the authenticator can verify a credential rather than only accepting anonymity. */
  readonly enforcing: boolean;
  /**
   * Resolves an attempt to a principal, or `null` when the credential is not acceptable. Returning
   * `null` is an authentication failure; throwing is a fault in the authenticator itself.
   */
  authenticate(attempt: AuthenticationAttempt): Promise<Principal | null>;
}
