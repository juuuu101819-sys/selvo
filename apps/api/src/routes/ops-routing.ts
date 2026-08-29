import {
  NotFoundError,
  routingOverrideTargetKey,
  uuidIdGenerator,
  type RoutingOverrideTarget,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../container.js';
import { parseOrThrow } from '../http/validation.js';
import { ONBOARDING_OPERATOR_HEADER, requireOnboardingOperator } from '../onboarding/operator.js';

const ASSET = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .regex(/^[A-Za-z0-9]+$/)
  .transform((value) => value.toUpperCase());

const targetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('provider'),
      providerId: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      kind: z.literal('corridor'),
      sourceAsset: ASSET,
      targetAsset: ASSET,
    })
    .strict(),
]);

const engageSchema = z
  .object({
    target: targetSchema,
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

const releaseSchema = z
  .object({
    target: targetSchema,
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

const credentialParams = z.object({ providerId: z.string().trim().min(1).max(128) }).strict();

const putCredentialSchema = z
  .object({
    keyName: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Z][A-Z0-9_]*$/, 'keyName must be an uppercase identifier'),
    secret: z.string().min(1).max(8192),
  })
  .strict();

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

function operatorSecret(): string | undefined {
  const value = process.env['ONBOARDING_OPERATOR_SECRET'];
  return value === undefined || value.trim() === '' ? undefined : value;
}

function presentedOperatorKey(request: FastifyRequest): string | undefined {
  const header = request.headers[ONBOARDING_OPERATOR_HEADER];
  return typeof header === 'string' ? header : undefined;
}

function toTarget(body: z.infer<typeof targetSchema>): RoutingOverrideTarget {
  if (body.kind === 'provider') {
    return { kind: 'provider', providerId: body.providerId };
  }
  return { kind: 'corridor', sourceAsset: body.sourceAsset, targetAsset: body.targetAsset };
}

function publicOverride(record: {
  readonly targetKey: string;
  readonly kind: string;
  readonly providerId: string | null;
  readonly sourceAsset: string | null;
  readonly targetAsset: string | null;
  readonly reason: string;
  readonly engagedAt: string;
  readonly engagedByActor: string;
}): {
  readonly targetKey: string;
  readonly kind: string;
  readonly providerId: string | null;
  readonly sourceAsset: string | null;
  readonly targetAsset: string | null;
  readonly reason: string;
  readonly engagedAt: string;
  readonly engagedByActor: string;
} {
  return {
    targetKey: record.targetKey,
    kind: record.kind,
    providerId: record.providerId,
    sourceAsset: record.sourceAsset,
    targetAsset: record.targetAsset,
    reason: record.reason,
    engagedAt: record.engagedAt,
    engagedByActor: record.engagedByActor,
  };
}

export function registerOpsRoutingRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.get('/ops/routing/overrides', (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    return envelope(request, {
      autoReset: false,
      overrides: container.manualOverrides.snapshot().map(publicOverride),
    });
  });

  app.post('/ops/routing/overrides', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const body = parseOrThrow(engageSchema, request.body, 'body');
    const target = toTarget(body.target);
    const targetKey = routingOverrideTargetKey(target);
    const nowIso = container.clock.nowIso();
    const record = await container.persistence.routingOverrides.engage({
      id: uuidIdGenerator.generate('rvo'),
      targetKey,
      kind: target.kind,
      providerId: target.kind === 'provider' ? target.providerId : null,
      sourceAsset: target.kind === 'corridor' ? target.sourceAsset : null,
      targetAsset: target.kind === 'corridor' ? target.targetAsset : null,
      reason: body.reason,
      engagedAt: nowIso,
      engagedByActor: 'onboarding_operator',
      releasedAt: null,
      releasedByActor: null,
      releaseReason: null,
    });
    container.manualOverrides.engage(record);
    await container.auditLogger.record({
      type: 'routing.override.engaged',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId: record.providerId,
      payload: {
        targetKey: record.targetKey,
        kind: record.kind,
        reason: record.reason,
        engagedAt: record.engagedAt,
        actor: 'onboarding_operator',
      },
    });
    return envelope(request, { override: publicOverride(record), autoReset: false });
  });

  app.post('/ops/routing/overrides/release', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const body = parseOrThrow(releaseSchema, request.body, 'body');
    const target = toTarget(body.target);
    const targetKey = routingOverrideTargetKey(target);
    const released = await container.persistence.routingOverrides.release({
      targetKey,
      releasedAt: container.clock.nowIso(),
      releasedByActor: 'onboarding_operator',
      releaseReason: body.reason,
    });
    if (released === null) {
      throw new NotFoundError('RoutingOverride', targetKey);
    }
    container.manualOverrides.release(targetKey);
    await container.auditLogger.record({
      type: 'routing.override.released',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId: released.providerId,
      payload: {
        targetKey: released.targetKey,
        kind: released.kind,
        reason: body.reason,
        releasedAt: released.releasedAt,
        actor: 'onboarding_operator',
      },
    });
    return envelope(request, { override: publicOverride(released), autoReset: false });
  });

  app.post('/ops/providers/:providerId/credentials', async (request, reply) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const { providerId } = parseOrThrow(credentialParams, request.params, 'params');
    const body = parseOrThrow(putCredentialSchema, request.body, 'body');
    await container.providerCredentialVault.putPlaintext(
      providerId,
      body.keyName,
      body.secret,
      container.clock.nowIso(),
    );
    await container.auditLogger.record({
      type: 'provider.credential.stored',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId,
      payload: {
        providerId,
        keyName: body.keyName,
        stored: true,
        actor: 'onboarding_operator',
      },
    });
    return reply.status(201).send(
      envelope(request, {
        providerId,
        keyName: body.keyName,
        stored: true,
      }),
    );
  });
}
