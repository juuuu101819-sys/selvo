import {
  BILLING_LIVE_SCOPE_KEY,
  ForbiddenError,
  LiveEnablementService,
  attemptLiveSubscriptionBilling,
  attemptPartnerPayouts,
  attemptPlatformFeeCollection,
  evaluateLiveBilling,
  evaluateLiveFundsMovement,
  formatCorridorKey,
  isLiveEnablementScope,
  LIVE_ENABLEMENT_SCOPES,
  PRICING_SHAPES,
  PRICING_SHAPE_LABELS,
  PRICING_SHAPE_RISK,
  parseCorridorKey,
  uuidIdGenerator,
  type LiveEnablementRecord,
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

const enableSchema = z
  .object({
    scope: z.enum(LIVE_ENABLEMENT_SCOPES),
    scopeKey: z.string().trim().min(1).max(128),
    region: z.string().trim().min(2).max(8),
    signOff: z.unknown(),
  })
  .strict();

const disableSchema = z
  .object({
    scope: z.enum(LIVE_ENABLEMENT_SCOPES),
    scopeKey: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

const evaluateQuery = z
  .object({
    sourceAsset: ASSET.optional(),
    destinationAsset: ASSET.optional(),
    partnerId: z.string().trim().min(1).max(128).optional(),
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

function publicRecord(record: LiveEnablementRecord): {
  readonly id: string;
  readonly scope: LiveEnablementRecord['scope'];
  readonly scopeKey: string;
  readonly region: string;
  readonly enabled: boolean;
  readonly signOff: LiveEnablementRecord['signOff'];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly disabledAt: string | null;
  readonly disabledReason: string | null;
} {
  return {
    id: record.id,
    scope: record.scope,
    scopeKey: record.scopeKey,
    region: record.region,
    enabled: record.enabled,
    signOff: { ...record.signOff },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    disabledAt: record.disabledAt,
    disabledReason: record.disabledReason,
  };
}

export function registerLiveEnablementRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  const service = new LiveEnablementService({ store: container.persistence.liveEnablement });

  app.get('/ops/live-enablement', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const records = await service.list();
    container.pricingShapes.hydrate(records);
    const admission = container.pricingShapes.current();
    return envelope(request, {
      partnerLiveEnabled: container.config.partnerLiveEnabled,
      billingLiveEnabled: container.config.billingLiveEnabled,
      billingCollectionMode: container.config.billingCollectionMode,
      pricingShapes: {
        activeShapes: admission.activeShapes,
        // Every shape with the reasons it is closed, so an operator can tell a flag that is off
        // from a flag that is on but missing its determination.
        decisions: PRICING_SHAPES.map((shape) => ({
          shape,
          label: PRICING_SHAPE_LABELS[shape],
          riskTier: PRICING_SHAPE_RISK[shape],
          flagEnabled: admission.decisions[shape].flagEnabled,
          active: admission.decisions[shape].active,
          blockingReasons: admission.decisions[shape].blockingReasons,
        })),
      },
      records: records.map(publicRecord),
    });
  });

  app.post('/ops/live-enablement', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const body = parseOrThrow(enableSchema, request.body, 'body');
    if (!isLiveEnablementScope(body.scope)) {
      throw new ForbiddenError('Unknown live-enablement scope.');
    }
    try {
      const record = await service.enable({
        scope: body.scope,
        scopeKey: body.scopeKey,
        region: body.region,
        signOff: body.signOff,
        nowIso: container.clock.nowIso(),
        id: uuidIdGenerator.generate('lve'),
      });
      // A recorded pricing determination is what opens a high-risk shape, so the in-process view
      // has to see it immediately rather than at the next restart.
      container.pricingShapes.hydrate(await service.list());
      await container.auditLogger.record({
        type: 'live_enablement.enabled',
        actor: 'onboarding_operator',
        requestId: request.id,
        comparisonId: null,
        providerId: body.scope === 'partner' ? record.scopeKey : null,
        payload: {
          scope: record.scope,
          scopeKey: record.scopeKey,
          region: record.region,
          checklistRef: record.signOff.checklistRef,
          approvedBy: record.signOff.approvedBy,
          expiresAt: record.signOff.expiresAt,
          liveFundsMovementActive: false,
          collectionActive: false,
        },
      });
      return envelope(request, {
        record: publicRecord(record),
        liveFundsMovementActive: false,
        collectionActive: false,
        sandbox: true,
      });
    } catch (error) {
      await container.auditLogger.record({
        type: 'live_enablement.refused',
        actor: 'onboarding_operator',
        requestId: request.id,
        comparisonId: null,
        providerId: null,
        payload: {
          scope: body.scope,
          scopeKey: body.scopeKey,
          liveFundsMovementActive: false,
          reason: error instanceof Error ? error.message : 'refused',
        },
      });
      throw error;
    }
  });

  app.post('/ops/live-enablement/disable', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const body = parseOrThrow(disableSchema, request.body, 'body');
    const record = await service.disable({
      scope: body.scope,
      scopeKey: body.scopeKey,
      reason: body.reason,
      nowIso: container.clock.nowIso(),
    });
    // Withdrawing a determination must close its shape on the next request, not eventually.
    container.pricingShapes.hydrate(await service.list());
    await container.auditLogger.record({
      type: 'live_enablement.disabled',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId: body.scope === 'partner' ? record.scopeKey : null,
      payload: {
        scope: record.scope,
        scopeKey: record.scopeKey,
        reason: body.reason,
      },
    });
    return envelope(request, { record: publicRecord(record), sandbox: true });
  });

  app.get('/ops/live-enablement/evaluate', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const query = parseOrThrow(evaluateQuery, request.query, 'query');
    const corridor =
      query.sourceAsset !== undefined && query.destinationAsset !== undefined
        ? formatCorridorKey(query.sourceAsset, query.destinationAsset)
        : 'USD|KRW';
    const { source, destination } = parseCorridorKey(corridor);
    const [corridorRecord, partnerRecord, billingRecord] = await Promise.all([
      service.find('corridor', corridor),
      query.partnerId === undefined
        ? Promise.resolve(null)
        : service.find('partner', query.partnerId),
      service.find('billing', BILLING_LIVE_SCOPE_KEY),
    ]);
    const funds = evaluateLiveFundsMovement({
      nowIso: container.clock.nowIso(),
      partnerLiveEnabled: container.config.partnerLiveEnabled,
      corridor,
      partnerId: query.partnerId ?? null,
      corridorRecord,
      partnerRecord,
      engagedRegions: container.manualOverrides.engagedRegions(),
    });
    const billing = evaluateLiveBilling({
      nowIso: container.clock.nowIso(),
      billingLiveEnabled: container.config.billingLiveEnabled,
      billingRecord,
    });
    return envelope(request, {
      corridor,
      sourceAsset: source,
      destinationAsset: destination,
      funds,
      billing,
    });
  });
}

export function registerLiveBillingGateRoutes(app: FastifyInstance, container: AppContainer): void {
  async function billingRecord(): Promise<LiveEnablementRecord | null> {
    return container.persistence.liveEnablement.find('billing', BILLING_LIVE_SCOPE_KEY);
  }

  // Bulk collection across every outstanding invoice. Per-invoice collection — the path that can
  // actually record or charge — lives at POST /ops/billing/invoices/:id/collect; this endpoint is
  // the gate probe for the whole-ledger run, and the gate is evaluated by the same service so the
  // two cannot disagree about whether collection is active.
  app.post('/ops/billing/collect', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const gate = await container.collections.gate();
    const result = attemptPlatformFeeCollection({
      nowIso: container.clock.nowIso(),
      billingLiveEnabled: container.config.billingLiveEnabled,
      billingRecord: await billingRecord(),
      collectorImplemented: gate.adapterImplemented,
    });
    await container.auditLogger.record({
      type: 'billing.collection.refused',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      payload: {
        collected: false,
        fundsMoved: false,
        realizedRevenue: false,
        billingLiveEnabled: result.billingLiveEnabled,
        reasons: [...result.blockingReasons],
      },
    });
    throw new ForbiddenError(
      'Platform-fee collection is not active. Invoices remain recorded-only (uncollected).',
      {
        flag: 'BILLING_LIVE_ENABLED',
        collected: false,
        fundsMoved: false,
        realizedRevenue: false,
        invoicesCollected: 0,
        reasons: result.blockingReasons,
        checklistRef: 'GO_LIVE_CHECKLIST.md#billing-collection',
      },
    );
  });

  app.post('/ops/billing/subscriptions/run', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const result = attemptLiveSubscriptionBilling({
      nowIso: container.clock.nowIso(),
      billingLiveEnabled: container.config.billingLiveEnabled,
      billingRecord: await billingRecord(),
    });
    await container.auditLogger.record({
      type: 'billing.subscription.refused',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      payload: {
        subscriptionsCharged: 0,
        billingLiveEnabled: result.billingLiveEnabled,
        reasons: [...result.blockingReasons],
      },
    });
    throw new ForbiddenError('Live subscription billing is not active.', {
      flag: 'BILLING_LIVE_ENABLED',
      subscriptionsCharged: 0,
      collected: false,
      fundsMoved: false,
      reasons: result.blockingReasons,
      checklistRef: 'GO_LIVE_CHECKLIST.md#billing-collection',
    });
  });

  app.post('/ops/billing/partner-payouts/run', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const result = attemptPartnerPayouts({
      nowIso: container.clock.nowIso(),
      billingLiveEnabled: container.config.billingLiveEnabled,
      billingRecord: await billingRecord(),
    });
    await container.auditLogger.record({
      type: 'billing.partner_payout.refused',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      payload: {
        payoutsDisbursed: 0,
        payableRowsCreated: 0,
        fundsMoved: false,
        billingLiveEnabled: result.billingLiveEnabled,
        reasons: [...result.blockingReasons],
      },
    });
    throw new ForbiddenError(
      'Partner payouts are not active. Commission attribution is not payable and is not disbursed.',
      {
        flag: 'BILLING_LIVE_ENABLED',
        payoutsDisbursed: 0,
        payableRowsCreated: 0,
        fundsMoved: false,
        reasons: result.blockingReasons,
        checklistRef: 'GO_LIVE_CHECKLIST.md#billing-collection',
      },
    );
  });
}
