import { SANDBOX_PARTNER_SCENARIOS } from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireOrganization } from '../http/require-organization.js';
import {
  dispatchPartnerInstructionSchema,
  parseOrThrow,
  partnerInstructionIdParamsSchema,
  partnerWebhookBodySchema,
  partnerWebhookParamsSchema,
  resolveRouteRequest,
} from '../http/validation.js';
import type { AppContainer } from '../container.js';

interface ResponseEnvelope<TData> {
  readonly data: TData;
  readonly meta: {
    readonly mode: string;
    readonly disclaimer: string;
    readonly requestId: string;
    readonly sandbox: true;
  };
}

/**
 * Sandbox execution-partner surface.
 *
 * Meridian forwards a caller-signed instruction and records partner-reported status. The partner
 * settles to the beneficiary. `POST /executions` remains 501. Live adapters never register while
 * `PARTNER_LIVE_ENABLED` is false (and none exist in this tree).
 */
export function registerPartnerInstructionRoutes(
  app: FastifyInstance,
  container: AppContainer,
): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
      sandbox: true,
    },
  });

  app.get('/execution-partners', (request) => {
    return envelope(request, {
      partners: container.partnerInstructions.catalog(),
      partnerLiveEnabled: container.config.partnerLiveEnabled,
      livePartnersRegistered: container.executionPartners.admitsKind('live'),
      fundsMoved: false,
      meridianKeysUsed: false,
      sandbox: true,
    });
  });

  app.post('/partner-instructions', async (request, reply) => {
    const principal = requireOrganization(request);
    const body = parseOrThrow(dispatchPartnerInstructionSchema, request.body, 'body');
    const resolved = resolveRouteRequest(body);
    const instruction = await container.partnerInstructions.dispatch({
      organizationId: principal.organizationId,
      actor: principal.actor,
      requestId: request.id,
      partnerId: body.partnerId ?? null,
      instruction: {
        quoteReference: body.quoteReference,
        sourceAsset: resolved.sourceAsset,
        destinationAsset: resolved.destinationAsset,
        amountMinorUnits: resolved.amountMinorUnits,
        beneficiaryRef: body.beneficiaryRef ?? null,
        signedAt: body.signedAt,
        signature: body.signature,
        sandboxScenario: body.sandboxScenario ?? SANDBOX_PARTNER_SCENARIOS[0],
      },
    });
    return reply.status(201).send(envelope(request, instruction));
  });

  app.get('/partner-instructions/:id', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(partnerInstructionIdParamsSchema, request.params, 'params');
    const instruction = await container.partnerInstructions.status({
      id,
      organizationId: principal.organizationId,
      actor: principal.actor,
      requestId: request.id,
    });
    return envelope(request, instruction);
  });

  app.post('/partner-webhooks/:partnerId', async (request) => {
    const { partnerId } = parseOrThrow(partnerWebhookParamsSchema, request.params, 'params');
    const body = parseOrThrow(partnerWebhookBodySchema, request.body, 'body');
    const instruction = await container.partnerInstructions.webhook({
      partnerId,
      event: {
        executionRef: body.executionRef,
        status: body.status,
        filledMinorUnits: body.filledMinorUnits ?? null,
        reasonCode: body.reasonCode ?? null,
      },
      actor: 'execution-partner',
      requestId: request.id,
    });
    return envelope(request, instruction);
  });
}
