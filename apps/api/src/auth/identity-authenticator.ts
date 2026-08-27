import {
  ANONYMOUS_PRINCIPAL,
  hashSecret,
  type AuthenticationAttempt,
  type Authenticator,
  type Clock,
  type IdentityStore,
  type Principal,
} from '@meridian/core';

const MAX_ACTOR_LENGTH = 128;
export const SESSION_PREFIX = 'mds_';
export const API_KEY_PREFIX_LENGTH = 16;

/**
 * Verifies session tokens and API keys against the identity store.
 *
 * Callers that present no credential remain anonymous so the public comparison page keeps working.
 * A credential that cannot be verified is rejected — returning anonymous here would let a client
 * that sent a token believe it was authenticated and scoped to a tenant.
 */
export class IdentityAuthenticator implements Authenticator {
  readonly scheme = 'session+api_key';
  readonly enforcing = true;

  constructor(
    private readonly identity: IdentityStore,
    private readonly clock: Clock,
  ) {}

  async authenticate(attempt: AuthenticationAttempt): Promise<Principal | null> {
    if (attempt.authorization !== null) {
      return this.fromAuthorization(attempt.authorization);
    }
    if (attempt.apiKey !== null) {
      return this.fromApiKey(attempt.apiKey);
    }
    return anonymousFrom(attempt.declaredActor);
  }

  private async fromAuthorization(header: string): Promise<Principal | null> {
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (match === null) {
      return null;
    }
    const token = match[1];
    if (token === undefined || !token.startsWith(SESSION_PREFIX)) {
      return null;
    }
    const resolved = await this.identity.findValidSessionByTokenHash(
      hashSecret(token),
      this.clock.nowIso(),
    );
    if (resolved === null) {
      return null;
    }
    if (resolved.session !== null) {
      await this.identity.touchSession(resolved.session.id, this.clock.nowIso());
    }
    return {
      kind: 'user',
      economicActor: 'human',
      organizationId: resolved.organization.id,
      subjectId: resolved.user.id,
      displayName: resolved.user.displayName,
      roles: [resolved.membership.role],
      actor: resolved.user.email,
      verified: true,
    };
  }

  private async fromApiKey(raw: string): Promise<Principal | null> {
    const presented = raw.trim();
    if (presented.length < API_KEY_PREFIX_LENGTH) {
      return null;
    }
    const key = await this.identity.findApiKeyByPrefix(presented.slice(0, API_KEY_PREFIX_LENGTH));
    if (key === null || key.revokedAt !== null) {
      return null;
    }
    if (hashSecret(presented) !== key.secretHash) {
      return null;
    }
    const organization = await this.identity.findOrganization(key.organizationId);
    if (organization === null || organization.status !== 'active') {
      return null;
    }
    await this.identity.touchApiKey(key.id, this.clock.nowIso());
    return {
      kind: 'service',
      economicActor: 'business',
      organizationId: organization.id,
      subjectId: key.id,
      displayName: key.label,
      roles: ['service'],
      actor: `apikey:${key.keyPrefix}`,
      verified: true,
    };
  }
}

function anonymousFrom(declaredActor: string | null): Principal {
  const declared = declaredActor?.trim() ?? '';
  if (declared === '') {
    return ANONYMOUS_PRINCIPAL;
  }
  return {
    ...ANONYMOUS_PRINCIPAL,
    actor: declared.slice(0, MAX_ACTOR_LENGTH),
    displayName: declared.slice(0, MAX_ACTOR_LENGTH),
    verified: false,
  };
}
