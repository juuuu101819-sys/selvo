import { ExecutionNotImplementedError, SANDBOX_PARTNER_SCENARIOS, ValidationError } from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../http/authentication.js';
import { requireOrganization } from '../http/require-organization.js';
import {
  createOrchestratedExecutionSchema,
  idempotencyKeySchema,
  parseOrThrow,
  partnerInstructionIdParamsSchema,
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
 * Execution boundary.
 *
 * `EXECUTION_ENABLED=false` (default): audited 501. The platform does not execute as principal.
 * `EXECUTION_ENABLED=true` in sandbox: orchestrates a mandate + selected route against mock
 * partners only. Meridian HMAC-signs the instruction with a vault partner credential; it does not
 * sign a funds transfer or hold customer keys.
 */
export function registerExecutionRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
      sandbox: true,
    },
  });

  app.post('/executions', async (request, reply) => {
    if (!container.config.executionEnabled) {
      const actor = principalOf(request).actor;
      await container.auditLogger.record({
        type: 'execution.rejected',
        actor,
        requestId: request.id,
        comparisonId: null,
        providerId: null,
        payload: {
          reason:
            'platform is non-custodial and does not execute transactions; delegated settlement is not implemented',
          delegateExecution: false,
          mode: container.config.mode,
        },
      });
      request.log.warn({ actor }, 'Execution attempt rejected: the platform is non-custodial');
      throw new ExecutionNotImplementedError();
    }

    const principal = requireOrganization(request);
    const body = parseOrThrow(createOrchestratedExecutionSchema, request.body, 'body');
    const idempotencyKey =
      parseOrThrow(idempotencyKeySchema, request.headers['idempotency-key'], 'headers') ?? null;
    const execution = await container.executions.create({
      organizationId: principal.organizationId,
      actor: principal.actor,
      requestId: request.id,
      mandateId: body.mandateId,
      routingId: body.routingId,
      routeId: body.routeId,
      beneficiaryRef: body.beneficiaryRef,
      idempotencyKey,
      complianceOutcome: body.complianceOutcome,
      sandboxScenario: body.sandboxScenario ?? SANDBOX_PARTNER_SCENARIOS[0],
    });
    return reply.status(201).send(envelope(request, execution));
  });

  app.get('/executions/:id', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(partnerInstructionIdParamsSchema, request.params, 'params');
    const execution = await container.executions.get(id, principal.organizationId, principal.actor, request.id);
    return envelope(request, execution);
  });

  app.get('/executions/:id/receipt', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(partnerInstructionIdParamsSchema, request.params, 'params');
    const execution = await container.executions.get(id, principal.organizationId, principal.actor, request.id);
    if (execution.status !== 'SETTLED') {
      throw new ValidationError('A receipt is issued only after sandbox partner settlement.', {
        failClosed: true,
        reason: 'receipt_not_settled',
        status: execution.status,
      });
    }
    const receipt = await container.receipts.get(execution.id, principal.organizationId);
    return envelope(request, receipt);
  });
}
