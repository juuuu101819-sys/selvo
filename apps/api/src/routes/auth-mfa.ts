import {
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
  dataEncryptionKeyFromHex,
  decryptAtRest,
  encryptAtRest,
  generateRecoveryCodes,
  generateTotpSecret,
  hashCredential,
  hashSessionToken,
  isRecoveryCodeShape,
  normalizeRecoveryCode,
  otpauthUrl,
  verifyPassword,
  verifyTotp,
  type IdentityUser,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { issueHumanSession } from '../auth/issue-session.js';
import type { AppContainer } from '../container.js';
import { recordMfaFailure } from '../http/auth-failure-audit.js';
import { requireOrganization } from '../http/require-organization.js';
import { parseOrThrow } from '../http/validation.js';

const totpCodeSchema = z
  .object({
    code: z.string().trim().min(6).max(16),
  })
  .strict();

const verifySchema = z
  .object({
    challengeToken: z.string().min(8).max(256),
    code: z.string().trim().min(6).max(16),
  })
  .strict();

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

export function registerMfaRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  const dek = (): Buffer => dataEncryptionKeyFromHex(container.config.dataEncryptionKey);

  app.get('/auth/mfa', async (request) => {
    const principal = requireHumanUser(request);
    const mfa = await container.persistence.identity.findUserMfa(principal.subjectId);
    const unused = await container.persistence.identity.listUnusedRecoveryCodes(principal.subjectId);
    return envelope(request, {
      enrolled: mfa?.mfaEnabledAt !== null && mfa?.mfaEnabledAt !== undefined,
      remainingRecoveryCodes: unused.length,
    });
  });

  app.post('/auth/mfa/enroll', async (request) => {
    const principal = requireHumanUser(request);
    const user = await requireActiveUser(container, principal.subjectId);
    const secret = generateTotpSecret();
    const existing = await container.persistence.identity.findUserMfa(user.id);
    await container.persistence.identity.saveUserMfa({
      userId: user.id,
      totpSecretCiphertext: existing?.totpSecretCiphertext ?? null,
      pendingTotpSecretCiphertext: encryptAtRest(secret, dek()),
      mfaEnabledAt: existing?.mfaEnabledAt ?? null,
    });
    return envelope(request, {
      secret,
      otpauthUrl: otpauthUrl(user.email, secret),
      issuer: 'Meridian',
    });
  });

  app.post('/auth/mfa/confirm', async (request) => {
    const principal = requireHumanUser(request);
    const body = parseOrThrow(totpCodeSchema, request.body, 'body');
    const user = await requireActiveUser(container, principal.subjectId);
    const mfa = await container.persistence.identity.findUserMfa(user.id);
    if (mfa === null || mfa.pendingTotpSecretCiphertext === null) {
      throw new ValidationError('Start MFA enrollment before confirming a code.', {
        mfaEnrollment: 'not_started',
      });
    }
    const pending = decryptAtRest(mfa.pendingTotpSecretCiphertext, dek());
    if (!verifyTotp(pending, body.code, container.clock.nowMs())) {
      await recordMfaFailure(container.auditLogger, request, user.id, 'invalid_code');
      throw new UnauthenticatedError('Authenticator code is incorrect.', {
        scheme: container.authenticator.scheme,
        enforcing: true,
      });
    }
    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(recoveryCodes.map((code) => hashCredential(code)));
    const enabledAt = container.clock.nowIso();
    await container.persistence.identity.saveUserMfa({
      userId: user.id,
      totpSecretCiphertext: encryptAtRest(pending, dek()),
      pendingTotpSecretCiphertext: null,
      mfaEnabledAt: enabledAt,
    });
    await container.persistence.identity.replaceRecoveryCodes(user.id, hashes);
    await container.auditLogger.record({
      type: 'auth.mfa.enrolled',
      actor: principal.actor,
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      organizationId: principal.organizationId,
      payload: { userId: user.id },
    });
    return envelope(request, { enrolled: true, recoveryCodes });
  });

  app.post('/auth/mfa/recovery/regenerate', async (request) => {
    const principal = requireHumanUser(request);
    const body = parseOrThrow(totpCodeSchema, request.body, 'body');
    const user = await requireActiveUser(container, principal.subjectId);
    const mfa = await container.persistence.identity.findUserMfa(user.id);
    if (mfa === null || mfa.mfaEnabledAt === null || mfa.totpSecretCiphertext === null) {
      throw new ValidationError('Enroll MFA before regenerating recovery codes.', {
        mfaEnrollment: 'not_enrolled',
      });
    }
    const secret = decryptAtRest(mfa.totpSecretCiphertext, dek());
    if (!verifyTotp(secret, body.code, container.clock.nowMs())) {
      await recordMfaFailure(container.auditLogger, request, user.id, 'invalid_code');
      throw new UnauthenticatedError('Authenticator code is incorrect.', {
        scheme: container.authenticator.scheme,
        enforcing: true,
      });
    }
    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(recoveryCodes.map((code) => hashCredential(code)));
    await container.persistence.identity.replaceRecoveryCodes(user.id, hashes);
    return envelope(request, { recoveryCodes });
  });

  app.post('/auth/mfa/verify', async (request, reply) => {
    const body = parseOrThrow(verifySchema, request.body, 'body');
    const failed = new UnauthenticatedError('Authenticator code is incorrect.', {
      scheme: container.authenticator.scheme,
      enforcing: true,
    });
    const tokenHash = hashSessionToken(body.challengeToken, container.config.sessionTokenPepper);
    const challenge = await container.persistence.identity.findValidMfaChallengeByTokenHash(
      tokenHash,
      container.clock.nowIso(),
    );
    if (challenge === null) {
      await recordMfaFailure(container.auditLogger, request, 'unknown', 'invalid_challenge');
      throw failed;
    }

    const user = await container.persistence.identity.findUserById(challenge.userId);
    const organization = await container.persistence.identity.findOrganization(
      challenge.organizationId,
    );
    const membership = await container.persistence.identity.findActiveMembership(
      challenge.userId,
      challenge.organizationId,
    );
    const mfa = await container.persistence.identity.findUserMfa(challenge.userId);
    if (
      user === null ||
      user.status !== 'active' ||
      organization === null ||
      organization.status !== 'active' ||
      membership === null ||
      mfa === null ||
      mfa.totpSecretCiphertext === null
    ) {
      await recordMfaFailure(container.auditLogger, request, challenge.userId, 'invalid_challenge');
      throw failed;
    }

    const accepted = await verifyMfaCode(container, mfa.totpSecretCiphertext, challenge.userId, body.code);
    if (!accepted) {
      await recordMfaFailure(container.auditLogger, request, challenge.userId, 'invalid_code');
      throw failed;
    }

    const consumed = await container.persistence.identity.consumeMfaChallenge(
      challenge.id,
      container.clock.nowIso(),
    );
    if (!consumed) {
      await recordMfaFailure(container.auditLogger, request, challenge.userId, 'invalid_challenge');
      throw failed;
    }

    const issued = await issueHumanSession({
      identity: container.persistence.identity,
      sessionTokenPepper: container.config.sessionTokenPepper,
      nowMs: container.clock.nowMs(),
      user,
      organization,
      role: membership.role,
    });
    return reply.status(201).send(envelope(request, issued));
  });
}

function requireHumanUser(
  request: FastifyRequest,
): ReturnType<typeof requireOrganization> & { subjectId: string } {
  const principal = requireOrganization(request);
  if (principal.kind !== 'user' || principal.subjectId === null) {
    throw new ForbiddenError('Only a signed-in user can manage multi-factor authentication.', {
      kind: principal.kind,
    });
  }
  return principal as ReturnType<typeof requireOrganization> & { subjectId: string };
}

async function requireActiveUser(
  container: AppContainer,
  userId: string,
): Promise<IdentityUser> {
  const user = await container.persistence.identity.findUserById(userId);
  if (user === null || user.status !== 'active') {
    throw new UnauthenticatedError('Sign in to continue.', {
      scheme: container.authenticator.scheme,
      enforcing: true,
    });
  }
  return user;
}

async function verifyMfaCode(
  container: AppContainer,
  totpSecretCiphertext: string,
  userId: string,
  presented: string,
): Promise<boolean> {
  const trimmed = presented.trim();
  if (/^\d{6}$/u.test(trimmed)) {
    const secret = decryptAtRest(
      totpSecretCiphertext,
      dataEncryptionKeyFromHex(container.config.dataEncryptionKey),
    );
    return verifyTotp(secret, trimmed, container.clock.nowMs());
  }
  if (!isRecoveryCodeShape(trimmed)) {
    return false;
  }
  const normalized = normalizeRecoveryCode(trimmed);
  const unused = await container.persistence.identity.listUnusedRecoveryCodes(userId);
  for (const row of unused) {
    const matches = await verifyPassword(normalized, row.codeHash);
    if (!matches) {
      continue;
    }
    return container.persistence.identity.consumeRecoveryCode(
      row.id,
      userId,
      container.clock.nowIso(),
    );
  }
  return false;
}
