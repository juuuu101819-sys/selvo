import { randomBytes } from 'node:crypto';
import { ForbiddenError, MandateRejectedError, NotFoundError, PaymentRequiredError, ValidationError } from '../errors/index.js';
import type { AuditLogger, Clock, IdGenerator } from '../ports/index.js';
import type { MandateStore } from '../ports/mandates.js';
import { parseAp2Mandate } from '../mandates/ap2.js';
import { parseMppMandate } from '../mandates/mpp.js';
import { parseX402Authorization, parseX402ScopeRequest, x402ChallengeResponse } from '../mandates/x402.js';
import { readFormat } from '../mandates/ingest.js';
import { requireUsableMandate } from '../mandates/policy-bridge.js';
import { intersectScopes } from '../mandates/scope.js';
import {
  toPublicMandate,
  type MandateScope,
  type PublicMandate,
  type StoredMandate,
} from '../mandates/types.js';

const X402_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface MandateServiceDependencies {
  readonly store: MandateStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
  readonly enabled: boolean;
}

export class MandateService {
  constructor(private readonly deps: MandateServiceDependencies) {}

  assertEnabled(): void {
    if (!this.deps.enabled) {
      throw new ForbiddenError('Mandate ingestion is disabled.', {
        failClosed: true,
        reason: 'ingestion_disabled',
        flag: 'MANDATE_INGESTION_ENABLED',
      });
    }
  }

  async verify(input: {
    readonly organizationId: string;
    readonly agentId: string;
    readonly credentialPrefix: string | null;
    readonly actor: string;
    readonly requestId: string;
    readonly body: unknown;
  }): Promise<PublicMandate> {
    this.assertEnabled();
    const now = this.deps.clock.nowIso();
    const format = readFormat(input.body);

    try {
      if (format === 'x402') {
        return await this.verifyX402(input, now);
      }
      const parsed = format === 'mpp' ? parseMppMandate(input.body, now) : parseAp2Mandate(input.body, now);
      const stored = await this.persistVerified(parsed, input, now);
      await this.deps.auditLogger.record({
        type: 'mandate.verified',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: null,
        organizationId: input.organizationId,
        payload: {
          mandateId: stored.id,
          format: stored.format,
          agentId: stored.agentId,
          payloadHash: stored.payloadHash,
          expiresAt: stored.expiresAt,
          fundsMoved: false,
          custody: false,
        },
      });
      return toPublicMandate(stored);
    } catch (error) {
      if (error instanceof PaymentRequiredError) {
        throw error;
      }
      const reason =
        (error instanceof MandateRejectedError || error instanceof ValidationError) &&
        typeof error.details['reason'] === 'string'
          ? error.details['reason']
          : 'scope_invalid';
      await this.deps.auditLogger.record({
        type: 'mandate.rejected',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: null,
        organizationId: input.organizationId,
        payload: {
          format,
          agentId: input.agentId,
          reason,
          fundsMoved: false,
        },
      });
      throw error;
    }
  }

  async get(id: string, organizationId: string): Promise<PublicMandate> {
    this.assertEnabled();
    const row = await this.deps.store.findById(id, organizationId);
    if (row === null) {
      throw new NotFoundError('Mandate', id);
    }
    return toPublicMandate(row);
  }

  async revoke(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<PublicMandate> {
    this.assertEnabled();
    const existing = await this.deps.store.findById(input.id, input.organizationId);
    if (existing === null) {
      throw new NotFoundError('Mandate', input.id);
    }
    if (existing.status === 'revoked') {
      return toPublicMandate(existing);
    }
    const revoked = await this.deps.store.revoke({
      id: input.id,
      organizationId: input.organizationId,
      actor: input.actor,
      nowIso: this.deps.clock.nowIso(),
    });
    if (revoked === null) {
      throw new NotFoundError('Mandate', input.id);
    }
    await this.deps.auditLogger.record({
      type: 'mandate.revoked',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
      providerId: null,
      organizationId: input.organizationId,
      payload: {
        mandateId: revoked.id,
        format: revoked.format,
        agentId: revoked.agentId,
        payloadHash: revoked.payloadHash,
        fundsMoved: false,
      },
    });
    return toPublicMandate(revoked);
  }

  async requireAttached(input: {
    readonly mandateId: string;
    readonly organizationId: string;
    readonly agentId: string | null;
  }): Promise<StoredMandate> {
    this.assertEnabled();
    const row = await this.deps.store.findById(input.mandateId, input.organizationId);
    if (row === null) {
      throw new NotFoundError('Mandate', input.mandateId);
    }
    if (input.agentId !== null && row.agentId !== input.agentId) {
      throw new NotFoundError('Mandate', input.mandateId);
    }
    requireUsableMandate(row.status, row.expiresAt, this.deps.clock.nowIso());
    return row;
  }

  async activeScopeForAgent(organizationId: string, agentId: string): Promise<MandateScope | null> {
    if (!this.deps.enabled) {
      return null;
    }
    const rows = await this.deps.store.listVerified(organizationId, agentId, this.deps.clock.nowIso());
    if (rows.length === 0) {
      return null;
    }
    return intersectScopes(rows.map((row) => row.scope));
  }

  private async verifyX402(
    input: {
      readonly organizationId: string;
      readonly agentId: string;
      readonly credentialPrefix: string | null;
      readonly actor: string;
      readonly requestId: string;
      readonly body: unknown;
    },
    nowIso: string,
  ): Promise<PublicMandate> {
    const root = input.body as Record<string, unknown>;
    const challengeId = typeof root['challengeId'] === 'string' ? root['challengeId'] : null;
    if (challengeId === null || root['authorization'] === undefined) {
      const scope = parseX402ScopeRequest(input.body);
      const challenge = await this.deps.store.saveChallenge({
        id: this.deps.ids.generate('x402'),
        organizationId: input.organizationId,
        agentId: input.agentId,
        nonce: randomBytes(16).toString('base64url'),
        scope,
        expiresAt: new Date(Date.parse(nowIso) + X402_CHALLENGE_TTL_MS).toISOString(),
        createdAt: nowIso,
      });
      throw new PaymentRequiredError('x402 payment authorization required.', {
        reason: 'challenge_required',
        challenge: x402ChallengeResponse(challenge),
      });
    }
    const challenge = await this.deps.store.findChallenge(challengeId, input.organizationId);
    if (challenge === null || challenge.agentId !== input.agentId) {
      throw new MandateRejectedError(
        'challenge_invalid',
        'x402 challenge is invalid or does not belong to this agent.',
      );
    }
    const parsed = parseX402Authorization(input.body, challenge, nowIso);
    await this.deps.store.deleteChallenge(challenge.id, input.organizationId);
    const stored = await this.persistVerified(parsed, input, nowIso);
    await this.deps.auditLogger.record({
      type: 'mandate.verified',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
      providerId: null,
      organizationId: input.organizationId,
      payload: {
        mandateId: stored.id,
        format: stored.format,
        agentId: stored.agentId,
        payloadHash: stored.payloadHash,
        expiresAt: stored.expiresAt,
        fundsMoved: false,
        custody: false,
      },
    });
    return toPublicMandate(stored);
  }

  private async persistVerified(
    parsed: {
      readonly format: StoredMandate['format'];
      readonly issuer: string;
      readonly expiresAt: string;
      readonly scope: MandateScope;
      readonly payload: StoredMandate['payload'];
      readonly payloadHash: string;
    },
    input: {
      readonly organizationId: string;
      readonly agentId: string;
      readonly credentialPrefix: string | null;
    },
    nowIso: string,
  ): Promise<StoredMandate> {
    return this.deps.store.save({
      id: this.deps.ids.generate('mdt'),
      organizationId: input.organizationId,
      agentId: input.agentId,
      format: parsed.format,
      status: 'verified',
      scope: parsed.scope,
      issuer: parsed.issuer,
      expiresAt: parsed.expiresAt,
      payloadHash: parsed.payloadHash,
      payload: parsed.payload,
      boundCredentialPrefix: input.credentialPrefix,
      verifiedAt: nowIso,
      revokedAt: null,
      revokedByActor: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }
}
