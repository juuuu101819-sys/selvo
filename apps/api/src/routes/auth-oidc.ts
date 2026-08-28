import {
  UnauthenticatedError,
  dataEncryptionKeyFromHex,
  decryptAtRest,
  encryptAtRest,
  hashSessionToken,
  randomToken,
  uuidIdGenerator,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OIDC_STATE_TTL_MS, issueHumanSession } from '../auth/issue-session.js';
import type { AppContainer } from '../container.js';
import { recordSsoFailure } from '../http/auth-failure-audit.js';
import { parseOrThrow } from '../http/validation.js';

const startSchema = z
  .object({
    organizationSlug: z.string().trim().min(1).max(128),
  })
  .strict();

const callbackSchema = z
  .object({
    code: z.string().min(1).max(4096),
    state: z.string().min(8).max(512),
  })
  .strict();

const SSO_UNAVAILABLE = 'SSO is not available for this organization.';
const SSO_UNMAPPED = 'Federated identity is not mapped to an organization member.';

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

export function registerOidcRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  const dek = () => dataEncryptionKeyFromHex(container.config.dataEncryptionKey);
  const unavailable = new UnauthenticatedError(SSO_UNAVAILABLE, {
    scheme: 'oidc',
    enforcing: true,
  });

  app.post('/auth/oidc/start', async (request) => {
    const body = parseOrThrow(startSchema, request.body, 'body');
    const organization = await container.persistence.identity.findOrganizationBySlug(
      body.organizationSlug.trim().toLowerCase(),
    );
    if (organization === null || organization.status !== 'active') {
      await recordSsoFailure(container.auditLogger, request, 'not_configured');
      throw unavailable;
    }
    const connection = await container.persistence.identity.findOidcConnection(organization.id);
    if (
      connection === null ||
      !connection.enabled ||
      connection.clientSecretCiphertext === null ||
      connection.clientSecretCiphertext === ''
    ) {
      await recordSsoFailure(container.auditLogger, request, 'not_configured');
      throw unavailable;
    }

    const state = randomToken('oidc_');
    const nonce = randomToken('nce_');
    const expiresAt = new Date(container.clock.nowMs() + OIDC_STATE_TTL_MS).toISOString();
    await container.persistence.identity.createOidcState({
      id: uuidIdGenerator.generate('oid'),
      stateHash: hashSessionToken(state, container.config.sessionTokenPepper),
      nonceCiphertext: encryptAtRest(nonce, dek()),
      organizationId: organization.id,
      expiresAt,
    });

    let clientSecret: string;
    try {
      clientSecret = decryptAtRest(connection.clientSecretCiphertext, dek());
    } catch {
      await recordSsoFailure(container.auditLogger, request, 'not_configured');
      throw unavailable;
    }
    if (clientSecret.length === 0) {
      await recordSsoFailure(container.auditLogger, request, 'not_configured');
      throw unavailable;
    }

    const authorizationUrl = await container.oidcClient.authorizationUrl({
      issuer: connection.issuer,
      clientId: connection.clientId,
      redirectUri: connection.redirectUri,
      state,
      nonce,
    });
    return envelope(request, {
      authorizationUrl,
      expiresAt,
      organization: {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
      },
    });
  });

  app.post('/auth/oidc/callback', async (request, reply) => {
    const body = parseOrThrow(callbackSchema, request.body, 'body');
    const unmapped = new UnauthenticatedError(SSO_UNMAPPED, {
      scheme: 'oidc',
      enforcing: true,
    });
    const invalid = new UnauthenticatedError('Federated identity could not be verified.', {
      scheme: 'oidc',
      enforcing: true,
    });

    const stateRow = await container.persistence.identity.consumeOidcState(
      hashSessionToken(body.state, container.config.sessionTokenPepper),
      container.clock.nowIso(),
    );
    if (stateRow === null) {
      await recordSsoFailure(container.auditLogger, request, 'invalid_state');
      throw invalid;
    }

    const organization = await container.persistence.identity.findOrganization(
      stateRow.organizationId,
    );
    const connection = await container.persistence.identity.findOidcConnection(
      stateRow.organizationId,
    );
    if (
      organization === null ||
      organization.status !== 'active' ||
      connection === null ||
      !connection.enabled ||
      connection.clientSecretCiphertext === null
    ) {
      await recordSsoFailure(container.auditLogger, request, 'not_configured');
      throw unavailable;
    }

    let clientSecret: string;
    let nonce: string;
    try {
      clientSecret = decryptAtRest(connection.clientSecretCiphertext, dek());
      nonce = decryptAtRest(stateRow.nonceCiphertext, dek());
    } catch {
      await recordSsoFailure(container.auditLogger, request, 'not_configured');
      throw unavailable;
    }

    let federated: { readonly email: string; readonly subject: string };
    try {
      federated = await container.oidcClient.exchangeCode({
        issuer: connection.issuer,
        clientId: connection.clientId,
        clientSecret,
        redirectUri: connection.redirectUri,
        code: body.code,
        nonce,
      });
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        await recordSsoFailure(container.auditLogger, request, 'idp_rejected');
        throw error;
      }
      await recordSsoFailure(container.auditLogger, request, 'idp_rejected');
      throw invalid;
    }

    const user = await container.persistence.identity.findUserByEmail(federated.email);
    if (user === null || user.status !== 'active') {
      await recordSsoFailure(container.auditLogger, request, 'unmapped_identity', federated.email);
      throw unmapped;
    }
    const membership = await container.persistence.identity.findActiveMembership(
      user.id,
      organization.id,
    );
    if (membership === null) {
      await recordSsoFailure(container.auditLogger, request, 'unmapped_identity', federated.email);
      throw unmapped;
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
