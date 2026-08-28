import { createHash } from 'node:crypto';
import type { AuditLogger, JsonObject } from '@meridian/core';
import type { FastifyRequest } from 'fastify';

export const AUTH_LOGIN_FAILED = 'auth.login.failed' as const;
export const AUTH_CREDENTIAL_FAILED = 'auth.credential.failed' as const;

export type AuthFailureCategory =
  | 'login_failed'
  | 'invalid_session'
  | 'invalid_api_key'
  | 'invalid_agent'
  | 'malformed_credential';

export type AuthIdentifierKind = 'email' | 'session' | 'api_key' | 'agent' | 'unknown';

export interface PresentedCredential {
  readonly presented: true;
  readonly category: AuthFailureCategory;
  readonly identifierKind: AuthIdentifierKind;
  readonly credentialPrefix?: string;
}

/**
 * Truncated SHA-256 of a normalised identifier. Correlates repeated attempts without storing the
 * email, password, or raw secret.
 */
export function hashAttemptedIdentifier(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 16);
}

export function publicCredentialPrefix(token: string): string | undefined {
  if (token.startsWith('mk_') || token.startsWith('mag_')) {
    return token.length >= 16 ? token.slice(0, 16) : token.startsWith('mag_') ? 'mag_' : 'mk_';
  }
  return undefined;
}

export function classifyPresentedCredential(
  authorization: string | null,
  apiKey: string | null,
): PresentedCredential | { readonly presented: false } {
  if (authorization !== null) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (match === null || match[1] === undefined) {
      return {
        presented: true,
        category: 'malformed_credential',
        identifierKind: 'unknown',
      };
    }
    const token = match[1];
    if (token.startsWith('mds_')) {
      return { presented: true, category: 'invalid_session', identifierKind: 'session' };
    }
    if (token.startsWith('mk_')) {
      return {
        presented: true,
        category: 'invalid_api_key',
        identifierKind: 'api_key',
        ...(publicCredentialPrefix(token) === undefined
          ? {}
          : { credentialPrefix: publicCredentialPrefix(token) }),
      };
    }
    if (token.startsWith('mag_')) {
      return {
        presented: true,
        category: 'invalid_agent',
        identifierKind: 'agent',
        ...(publicCredentialPrefix(token) === undefined
          ? {}
          : { credentialPrefix: publicCredentialPrefix(token) }),
      };
    }
    return { presented: true, category: 'malformed_credential', identifierKind: 'unknown' };
  }
  if (apiKey !== null) {
    if (apiKey.startsWith('mag_')) {
      return {
        presented: true,
        category: 'invalid_agent',
        identifierKind: 'agent',
        ...(publicCredentialPrefix(apiKey) === undefined
          ? {}
          : { credentialPrefix: publicCredentialPrefix(apiKey) }),
      };
    }
    return {
      presented: true,
      category: 'invalid_api_key',
      identifierKind: 'api_key',
      ...(publicCredentialPrefix(apiKey) === undefined
        ? {}
        : { credentialPrefix: publicCredentialPrefix(apiKey) }),
    };
  }
  return { presented: false };
}

export function sourceIpOf(request: FastifyRequest): string | null {
  const ip = request.ip;
  if (typeof ip !== 'string') {
    return null;
  }
  const trimmed = ip.trim();
  return trimmed === '' || trimmed.length > 64 ? null : trimmed;
}

function payloadFor(
  presented: PresentedCredential,
  extras: JsonObject,
): JsonObject {
  return {
    category: presented.category,
    identifierKind: presented.identifierKind,
    ...(presented.credentialPrefix === undefined
      ? {}
      : { credentialPrefix: presented.credentialPrefix }),
    ...extras,
  };
}

export async function recordLoginFailure(
  auditLogger: AuditLogger,
  request: FastifyRequest,
  email: string,
): Promise<void> {
  await auditLogger.record({
    type: AUTH_LOGIN_FAILED,
    actor: 'anonymous',
    requestId: request.id,
    comparisonId: null,
    providerId: null,
    organizationId: null,
    payload: {
      category: 'login_failed',
      identifierKind: 'email',
      identifierHash: hashAttemptedIdentifier(email),
      sourceIp: sourceIpOf(request),
    },
  });
}

export async function recordCredentialFailure(
  auditLogger: AuditLogger,
  request: FastifyRequest,
  presented: PresentedCredential,
): Promise<void> {
  await auditLogger.record({
    type: AUTH_CREDENTIAL_FAILED,
    actor: 'anonymous',
    requestId: request.id,
    comparisonId: null,
    providerId: null,
    organizationId: null,
    payload: payloadFor(presented, { sourceIp: sourceIpOf(request) }),
  });
}
