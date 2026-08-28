import {
  AGENT_CREDENTIAL_PREFIX,
  ANONYMOUS_PRINCIPAL,
  hashSecret,
  hashSessionToken,
  legacySha256VerificationAllowed,
  sessionScopesForRole,
  isDemoAgentSecret,
  verifyAndUpgradeCredential,
  type AgentPaymentsRepository,
  type AuthenticationAttempt,
  type Authenticator,
  type Clock,
  type IdentityStore,
  type Principal,
} from '@meridian/core';

export const SESSION_PREFIX = 'mds_';
export const API_KEY_PREFIX_LENGTH = 16;

export interface IdentityAuthenticatorOptions {
  readonly rejectDemoSecrets?: boolean;
  readonly sessionTokenPepper: string;
}

/**
 * Verifies session tokens, organization API keys (`mk_`) and agent credentials (`mag_`).
 *
 * Callers that present no credential remain anonymous so the public comparison page keeps working.
 * A credential that cannot be verified is rejected — returning anonymous here would let a client
 * that sent a token believe it was authenticated and scoped to a tenant.
 *
 * Audit `actor` is taken only from the verified session/key. `X-Meridian-Actor` and any
 * client-supplied actor field are ignored (PA-M04).
 */
export class IdentityAuthenticator implements Authenticator {
  readonly scheme = 'session+api_key';
  readonly enforcing = true;

  constructor(
    private readonly identity: IdentityStore,
    private readonly clock: Clock,
    private readonly agentPayments: AgentPaymentsRepository,
    private readonly options: IdentityAuthenticatorOptions,
  ) {}

  async authenticate(attempt: AuthenticationAttempt): Promise<Principal | null> {
    if (attempt.authorization !== null) {
      return this.fromAuthorization(attempt.authorization);
    }
    if (attempt.apiKey !== null) {
      return this.fromPresentedSecret(attempt.apiKey);
    }
    return ANONYMOUS_PRINCIPAL;
  }

  private async fromAuthorization(header: string): Promise<Principal | null> {
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (match === null) {
      return null;
    }
    const token = match[1];
    if (token === undefined) {
      return null;
    }
    if (token.startsWith(SESSION_PREFIX)) {
      return this.fromSession(token);
    }
    if (token.startsWith(AGENT_CREDENTIAL_PREFIX) || token.startsWith('mk_')) {
      return this.fromPresentedSecret(token);
    }
    return null;
  }

  private async fromSession(token: string): Promise<Principal | null> {
    const nowIso = this.clock.nowIso();
    const hmacHash = hashSessionToken(token, this.options.sessionTokenPepper);
    let resolved = await this.identity.findValidSessionByTokenHash(hmacHash, nowIso);
    if (resolved === null && legacySha256VerificationAllowed(this.clock.nowMs())) {
      resolved = await this.identity.findValidSessionByTokenHash(hashSecret(token), nowIso);
      if (resolved?.session !== null && resolved?.session !== undefined) {
        await this.identity.replaceSessionTokenHash(resolved.session.id, hmacHash);
      }
    }
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
      scopes: sessionScopesForRole(resolved.membership.role),
      actor: resolved.user.email,
      verified: true,
    };
  }

  private async fromPresentedSecret(raw: string): Promise<Principal | null> {
    const presented = raw.trim();
    if (presented.length < API_KEY_PREFIX_LENGTH) {
      return null;
    }
    if (this.options.rejectDemoSecrets === true && isDemoAgentSecret(presented)) {
      return null;
    }
    if (presented.startsWith(AGENT_CREDENTIAL_PREFIX)) {
      return this.fromAgentCredential(presented);
    }
    const key = await this.identity.findApiKeyByPrefix(presented.slice(0, API_KEY_PREFIX_LENGTH));
    if (key === null || key.revokedAt !== null) {
      return null;
    }
    if (key.expiresAt !== null && key.expiresAt <= this.clock.nowIso()) {
      return null;
    }
    const verified = await verifyAndUpgradeCredential(presented, key.secretHash, this.clock.nowMs());
    if (!verified.ok) {
      return null;
    }
    if (verified.upgradedHash !== undefined) {
      await this.identity.replaceApiKeySecretHash(key.id, verified.upgradedHash);
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
      scopes: key.scopes,
      actor: `apikey:${key.keyPrefix}`,
      verified: true,
    };
  }

  private async fromAgentCredential(presented: string): Promise<Principal | null> {
    const credential = await this.agentPayments.findCredentialByPrefix(
      presented.slice(0, API_KEY_PREFIX_LENGTH),
    );
    if (credential === null || credential.revokedAt !== null) {
      return null;
    }
    if (credential.expiresAt !== null && credential.expiresAt <= this.clock.nowIso()) {
      return null;
    }
    const verified = await verifyAndUpgradeCredential(
      presented,
      credential.secretHash,
      this.clock.nowMs(),
    );
    if (!verified.ok) {
      return null;
    }
    if (verified.upgradedHash !== undefined) {
      await this.agentPayments.replaceCredentialSecretHash(credential.id, verified.upgradedHash);
    }
    const agent = await this.agentPayments.findAgent(credential.agentId, credential.organizationId);
    if (agent === null || agent.status !== 'active') {
      return null;
    }
    const organization = await this.identity.findOrganization(credential.organizationId);
    if (organization === null || organization.status !== 'active') {
      return null;
    }
    await this.agentPayments.touchCredential(credential.id, this.clock.nowIso());
    return {
      kind: 'agent',
      economicActor: 'ai_agent',
      organizationId: organization.id,
      subjectId: agent.id,
      displayName: agent.name,
      roles: ['agent'],
      scopes: credential.scopes,
      actor: `agent:${credential.keyPrefix}`,
      verified: true,
    };
  }
}
