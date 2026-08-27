import {
  DEFAULT_API_KEY_SCOPES,
  NotFoundError,
  hashSecret,
  parseApiScopes,
  randomToken,
  uuidIdGenerator,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContainer } from '../container.js';
import { API_KEY_PREFIX_LENGTH } from '../auth/identity-authenticator.js';
import { requireKeyManager, requireOrganization } from '../http/require-organization.js';
import { apiKeyIdParamsSchema, createApiKeySchema, parseOrThrow } from '../http/validation.js';

const ISSUED_KEY_PREFIX = 'mk_';

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

/**
 * Organization API key management.
 *
 * Secrets are hashed (SHA-256) before persist. The raw secret is returned once on issue and never
 * logged. Listing returns prefixes, scopes, expiry and revocation — never the hash.
 */
export function registerApiKeyRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.get('/api-keys', async (request) => {
    const principal = requireOrganization(request);
    const apiKeys = await container.persistence.identity.listApiKeys(principal.organizationId);
    return envelope(request, { apiKeys });
  });

  app.post('/api-keys', async (request, reply) => {
    const principal = requireKeyManager(request);
    const body = parseOrThrow(createApiKeySchema, request.body, 'body');
    const scopes =
      body.scopes === undefined ? DEFAULT_API_KEY_SCOPES : parseApiScopes(body.scopes);
    const secret = randomToken(ISSUED_KEY_PREFIX);
    const keyPrefix = secret.slice(0, API_KEY_PREFIX_LENGTH);
    const id = uuidIdGenerator.generate('key');
    const createdAt = container.clock.nowIso();
    const expiresAt = body.expiresAt ?? null;

    await container.persistence.identity.createApiKey({
      id,
      organizationId: principal.organizationId,
      keyPrefix,
      secretHash: hashSecret(secret),
      label: body.label,
      createdAt,
      scopes,
      expiresAt,
    });

    await container.auditLogger.record({
      type: 'apikey.issued',
      actor: principal.actor,
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      payload: {
        keyId: id,
        keyPrefix,
        scopes: [...scopes],
        expiresAt,
      },
    });

    return reply.status(201).send(
      envelope(request, {
        id,
        keyPrefix,
        label: body.label,
        scopes,
        expiresAt,
        createdAt,
        revokedAt: null,
        secret,
      }),
    );
  });

  app.post('/api-keys/:id/revoke', async (request) => {
    const principal = requireKeyManager(request);
    const { id } = parseOrThrow(apiKeyIdParamsSchema, request.params, 'params');
    const revoked = await container.persistence.identity.revokeApiKey(
      id,
      principal.organizationId,
      container.clock.nowIso(),
    );
    if (!revoked) {
      throw new NotFoundError('ApiKey', id);
    }

    await container.auditLogger.record({
      type: 'apikey.revoked',
      actor: principal.actor,
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      payload: { keyId: id },
    });

    return envelope(request, { id, revoked: true });
  });
}
