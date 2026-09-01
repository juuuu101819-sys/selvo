import {
  ForbiddenError,
  NotFoundError,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { capabilityPreHandler, requireOrganization } from '../http/require-organization.js';
import { principalCredentialPrefix } from '../http/mandate-context.js';
import { parseOrThrow } from '../http/validation.js';
import type { AppContainer } from '../container.js';
import { z } from 'zod';

const mandateIdParamsSchema = z.object({ id: z.string().trim().min(1).max(128) }).strict();

interface ResponseEnvelope<TData> {
  readonly data: TData;
  readonly meta: {
    readonly mode: string;
    readonly disclaimer: string;
    readonly requestId: string;
    readonly sandbox: true;
  };
}

export function registerMandateRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
      sandbox: true,
    },
  });

  app.post(
    '/mandates/verify',
    { preHandler: [capabilityPreHandler('mandate:verify')] },
    async (request, reply) => {
      const principal = requireOrganization(request);
      if (principal.kind !== 'agent' || principal.subjectId === null) {
        throw new ForbiddenError('Mandate verification must be presented by a mag_ agent credential.', {
          failClosed: true,
        });
      }
      const mandate = await container.mandates.verify({
        organizationId: principal.organizationId,
        agentId: principal.subjectId,
        credentialPrefix: principalCredentialPrefix(principal),
        actor: principal.actor,
        requestId: request.id,
        body: request.body,
      });
      return reply.status(201).send(envelope(request, mandate));
    },
  );

  app.get('/mandates/:id', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(mandateIdParamsSchema, request.params, 'params');
    const mandate = await container.mandates.get(id, principal.organizationId);
    if (principal.kind === 'agent' && mandate.agentId !== principal.subjectId) {
      throw new NotFoundError('Mandate', id);
    }
    return envelope(request, mandate);
  });

  app.post(
    '/mandates/:id/revoke',
    { preHandler: [capabilityPreHandler('mandate:revoke')] },
    async (request) => {
      const principal = requireOrganization(request);
      const { id } = parseOrThrow(mandateIdParamsSchema, request.params, 'params');
      const mandate = await container.mandates.revoke({
        id,
        organizationId: principal.organizationId,
        actor: principal.actor,
        requestId: request.id,
      });
      return envelope(request, mandate);
    },
  );
}
