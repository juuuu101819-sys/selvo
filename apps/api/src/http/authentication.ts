import {
  ANONYMOUS_PRINCIPAL,
  UnauthenticatedError,
  type AuditLogger,
  type Authenticator,
  type Principal,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  classifyPresentedCredential,
  recordCredentialFailure,
} from './auth-failure-audit.js';

/**
 * Per-request identity, held in a WeakMap keyed by the request.
 *
 * Fastify refuses to decorate a request with a reference type, since one object would be shared
 * across every request — exactly the sort of cross-request leak that matters when the value is an
 * identity. A WeakMap sidesteps that, needs no module augmentation, and drops its entries when the
 * request is collected.
 */
const principals = new WeakMap<FastifyRequest, Principal>();

/**
 * The caller's identity. Defaults to anonymous, so a handler reached by some future path that
 * bypasses the hook still sees a valid, clearly unverified principal rather than crashing.
 */
export function principalOf(request: FastifyRequest): Principal {
  return principals.get(request) ?? ANONYMOUS_PRINCIPAL;
}

/**
 * Resolves the caller's identity once per request, before any route handler runs.
 *
 * Handlers then read the principal instead of picking headers apart themselves, so there is exactly
 * one place where a credential becomes an identity — and adding real authentication in Phase 2 means
 * replacing the injected authenticator, not touching the routes.
 */
export function registerAuthentication(
  app: FastifyInstance,
  authenticator: Authenticator,
  auditLogger: AuditLogger,
): void {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const authorization = singleHeader(request, 'authorization');
    const apiKey = singleHeader(request, 'x-api-key');
    const principal = await authenticator.authenticate({
      authorization,
      apiKey,
      declaredActor: singleHeader(request, 'x-meridian-actor'),
    });

    if (principal === null) {
      const presented = classifyPresentedCredential(authorization, apiKey);
      if (presented.presented) {
        await recordCredentialFailure(auditLogger, request, presented);
      }
      throw new UnauthenticatedError(
        authenticator.enforcing
          ? 'The credential could not be verified.'
          : 'This deployment cannot verify credentials. Retry without an Authorization or X-Api-Key ' +
              'header; requests are served as an unauthenticated caller.',
        { scheme: authenticator.scheme, enforcing: authenticator.enforcing },
      );
    }

    principals.set(request, principal);
  });
}

/**
 * Access log without secrets.
 *
 * Method, URL, status, request id, principal kind, organization id and a safe actor label
 * (`apikey:` + prefix for machine callers). The raw API key and session token never appear.
 */
export function registerRequestLogging(app: FastifyInstance): void {
  app.addHook('onResponse', (request, reply, done) => {
    const principal = principalOf(request);
    request.log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        requestId: request.id,
        principalKind: principal.kind,
        organizationId: principal.organizationId,
        actor: principal.actor,
      },
      'request completed',
    );
    done();
  });
}

function singleHeader(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first.trim() === '' ? null : first;
}
