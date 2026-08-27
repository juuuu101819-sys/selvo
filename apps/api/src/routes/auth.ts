import {
  UnauthenticatedError,
  hashSecret,
  randomToken,
  uuidIdGenerator,
  verifyPassword,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SESSION_PREFIX } from '../auth/identity-authenticator.js';
import type { AppContainer } from '../container.js';
import { principalOf } from '../http/authentication.js';
import { requireOrganization } from '../http/require-organization.js';
import { parseOrThrow } from '../http/validation.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const loginSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(8).max(128),
  })
  .strict();

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

export function registerAuthRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.post('/auth/login', async (request, reply) => {
    const body = parseOrThrow(loginSchema, request.body, 'body');
    const user = await container.persistence.identity.findUserByEmail(body.email);
    // Same response for unknown user and wrong password so the endpoint cannot be used to
    // enumerate accounts.
    const failed = new UnauthenticatedError('Email or password is incorrect.', {
      scheme: container.authenticator.scheme,
      enforcing: true,
    });
    if (user === null || user.status !== 'active' || user.passwordHash === null) {
      throw failed;
    }
    const matches = await verifyPassword(body.password, user.passwordHash);
    if (!matches) {
      throw failed;
    }
    const memberships = await container.persistence.identity.listMembershipsForUser(user.id);
    const membership = memberships[0];
    if (membership === undefined) {
      throw new UnauthenticatedError('This account has no active organization membership.', {
        scheme: container.authenticator.scheme,
        enforcing: true,
      });
    }
    const organization = await container.persistence.identity.findOrganization(
      membership.organizationId,
    );
    if (organization === null || organization.status !== 'active') {
      throw failed;
    }

    const token = randomToken(SESSION_PREFIX);
    const expiresAt = new Date(container.clock.nowMs() + SESSION_TTL_MS).toISOString();
    const sessionId = uuidIdGenerator.generate('ses');
    await container.persistence.identity.createSession({
      id: sessionId,
      userId: user.id,
      organizationId: organization.id,
      tokenHash: hashSecret(token),
      expiresAt,
    });

    return reply.status(201).send(
      envelope(request, {
        token,
        expiresAt,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          countryCode: organization.countryCode,
        },
        role: membership.role,
      }),
    );
  });

  app.post('/auth/logout', async (request, reply) => {
    const principal = principalOf(request);
    if (principal.kind === 'user' && principal.subjectId !== null) {
      const header = request.headers.authorization;
      const token = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header)?.[1] : undefined;
      if (token !== undefined) {
        const resolved = await container.persistence.identity.findValidSessionByTokenHash(
          hashSecret(token),
          container.clock.nowIso(),
        );
        if (resolved?.session !== null && resolved?.session !== undefined) {
          await container.persistence.identity.revokeSession(
            resolved.session.id,
            container.clock.nowIso(),
          );
        }
      }
    }
    return reply.send(envelope(request, { signedOut: true }));
  });

  app.get('/auth/me', async (request) => {
    const principal = requireOrganization(request);
    const organization = await container.persistence.identity.findOrganization(
      principal.organizationId,
    );
    const user =
      principal.kind === 'user' && principal.subjectId !== null
        ? await container.persistence.identity.findUserById(principal.subjectId)
        : null;
    return envelope(request, {
      kind: principal.kind,
      role: principal.roles[0] ?? null,
      user:
        user === null
          ? { id: principal.subjectId, email: null, displayName: principal.displayName }
          : { id: user.id, email: user.email, displayName: user.displayName },
      organization:
        organization === null
          ? { id: principal.organizationId, name: principal.displayName, slug: '', countryCode: '' }
          : {
              id: organization.id,
              name: organization.name,
              slug: organization.slug,
              countryCode: organization.countryCode,
            },
    });
  });
}
