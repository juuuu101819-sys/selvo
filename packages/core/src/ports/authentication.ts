/**
 * Authentication architecture.
 *
 * Prepared, not implemented. Phase 1 resolves every caller to {@link ANONYMOUS_PRINCIPAL}; the
 * point of defining the shape now is that the things which are hard to retrofit — a tenant
 * boundary on every request, an authenticated actor on every audit event, a single place where a
 * credential is turned into an identity — exist from the start.
 *
 * Deliberately out of scope: SSO, SAML, SCIM, MFA and federated identity. See docs/ROADMAP.md.
 */

export const PRINCIPAL_KINDS = ['anonymous', 'user', 'service'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

/**
 * Who is making a request.
 *
 * `organizationId` is the tenant boundary every future query is scoped by. It is nullable only
 * because Phase 1 has no tenants; once authentication is real, a null organization on a
 * business-data request is a bug rather than a valid state.
 */
export interface Principal {
  readonly kind: PrincipalKind;
  readonly organizationId: string | null;
  /** User id or API key id, depending on `kind`. */
  readonly subjectId: string | null;
  readonly displayName: string;
  readonly roles: readonly string[];
  /**
   * Label recorded on audit events. For an authenticated principal this is derived from the
   * verified identity; for an anonymous one it is a caller-supplied hint and must not be trusted.
   */
  readonly actor: string;
  /** True when `actor` came from a verified credential rather than a request header. */
  readonly verified: boolean;
}

export const ANONYMOUS_PRINCIPAL: Principal = {
  kind: 'anonymous',
  organizationId: null,
  subjectId: null,
  displayName: 'Anonymous',
  roles: [],
  actor: 'anonymous',
  verified: false,
};

/** The credential material an authenticator is given, extracted from the transport. */
export interface AuthenticationAttempt {
  /** Raw `Authorization` header, if present. */
  readonly authorization: string | null;
  /** Raw API key header, if present. */
  readonly apiKey: string | null;
  /** Unverified actor hint, used only when no credential is presented. */
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
