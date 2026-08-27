import {
  DAILY_SPENDING_STATUSES,
  paymentIntentFingerprint,
  utcDayWindow,
  weightsForRoutePreference,
  type Agent,
  type Merchant,
  type PaymentIntent,
  type PaymentPolicy,
  type QuotedRouteOption,
  type RoutePreference,
} from '../domain/agent-payments.js';
import { parsePayInstruction, resolveMerchant } from '../domain/payment-instruction.js';
import { evaluatePaymentPolicy, filterRoutesByPolicy } from '../domain/payment-policy.js';
import {
  IdempotencyConflictError,
  NoRoutesAvailableError,
  NotFoundError,
  PolicyDeniedError,
  QuoteExpiredError,
  ValidationError,
  isAppError,
} from '../errors/index.js';
import { assertAssetCode, toAssetMinorUnits } from '../domain/asset.js';
import type { JsonObject } from '../domain/json.js';
import type {
  AgentPaymentsRepository,
  AuditLogger,
  Clock,
  IdGenerator,
} from '../ports/index.js';
import { simulateSandboxExecution } from './sandbox-simulator.js';
import { MultiRailRouter } from './routing-engine.js';
import type { ScoredMultiRailRoute } from './routing-types.js';

const DEFAULT_INTENT_TTL_MS = 3_600_000;

export interface CreatePaymentIntentCommand {
  readonly organizationId: string;
  readonly actorAgentId: string | null;
  readonly bodyAgentId: string | undefined;
  readonly instruction: string | undefined;
  readonly sourceAsset: string | undefined;
  readonly destinationAsset: string | undefined;
  readonly amount: string | undefined;
  readonly recipient: string | undefined;
  readonly purpose: string | undefined;
  readonly routePreference: RoutePreference | null;
  readonly maxFeeBps: string | null;
  readonly expiresAt: string | undefined;
  readonly idempotencyKey: string | null;
  readonly actor: string;
  readonly requestId: string;
}

export interface AgentPaymentServiceDependencies {
  readonly agentPayments: AgentPaymentsRepository;
  readonly routing: MultiRailRouter;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
}

export class AgentPaymentService {
  constructor(private readonly deps: AgentPaymentServiceDependencies) {}

  async createIntent(command: CreatePaymentIntentCommand): Promise<PaymentIntent> {
    const agentId = command.actorAgentId ?? command.bodyAgentId;
    if (agentId === undefined) {
      throw new ValidationError('agentId is required when the caller is not an agent.', {});
    }
    if (command.actorAgentId !== null && command.bodyAgentId !== undefined && command.bodyAgentId !== command.actorAgentId) {
      throw new ValidationError('agentId must match the authenticated agent.', {});
    }

    const agent = await this.requireAgent(agentId, command.organizationId);
    const merchants = await this.deps.agentPayments.listMerchants(command.organizationId);
    const resolved = resolveCreateFields(command, merchants);
    const policy = await this.requirePolicy(command.organizationId, agent.id);
    const expiresAt = command.expiresAt ?? new Date(this.deps.clock.nowMs() + DEFAULT_INTENT_TTL_MS).toISOString();
    if (Date.parse(expiresAt) <= this.deps.clock.nowMs()) {
      throw new ValidationError('expiresAt must be in the future.', { expiresAt });
    }

    const fingerprint = paymentIntentFingerprint({
      agentId: agent.id,
      sourceAsset: resolved.sourceAsset,
      destinationAsset: resolved.destinationAsset,
      amountMinorUnits: resolved.amountMinorUnits,
      recipient: resolved.recipient,
      purpose: resolved.purpose,
      routePreference: command.routePreference,
      maxFeeBps: command.maxFeeBps,
      expiresAt,
    });

    if (command.idempotencyKey !== null) {
      const existing = await this.deps.agentPayments.findIntentByIdempotencyKey(
        command.organizationId,
        agent.id,
        command.idempotencyKey,
      );
      if (existing !== null) {
        if (existing.payloadFingerprint !== fingerprint) {
          throw new IdempotencyConflictError(command.idempotencyKey);
        }
        return existing;
      }
    }

    await this.assertPolicy(policy, {
      amountMinorUnits: resolved.amountMinorUnits,
      sourceAsset: resolved.sourceAsset,
      destinationAsset: resolved.destinationAsset,
      recipientCode: resolved.recipient,
      maxFeeBps: command.maxFeeBps,
      selectedProviderId: null,
      selectedRouteCostBps: null,
      actor: command.actor,
      requestId: command.requestId,
      paymentIntentId: null,
    });

    const now = this.deps.clock.nowIso();
    const intent: PaymentIntent = {
      id: this.deps.ids.generate('pint'),
      organizationId: command.organizationId,
      agentId: agent.id,
      sourceAsset: resolved.sourceAsset,
      destinationAsset: resolved.destinationAsset,
      amountMinorUnits: resolved.amountMinorUnits,
      recipient: resolved.recipient,
      purpose: resolved.purpose,
      routePreference: command.routePreference,
      maxFeeBps: command.maxFeeBps,
      expiresAt,
      status: 'CREATED',
      idempotencyKey: command.idempotencyKey,
      payloadFingerprint: fingerprint,
      quotedRoutes: [],
      quoteExpiresAt: null,
      selectedRouteId: null,
      authorizedAt: null,
      simulatedAt: null,
      simulation: null,
      failureReason: null,
      fundsMoved: false,
      custody: false,
      realExecution: false,
      actor: command.actor,
      createdAt: now,
      updatedAt: now,
    };

    const stored = await this.deps.agentPayments.createIntent(intent);
    await this.deps.auditLogger.record({
      type: 'payment.intent.created',
      actor: command.actor,
      requestId: command.requestId,
      comparisonId: null,
      providerId: null,
      payload: {
        paymentIntentId: stored.id,
        agentId: stored.agentId,
        recipient: stored.recipient,
        sourceAsset: stored.sourceAsset,
        destinationAsset: stored.destinationAsset,
        amountMinorUnits: stored.amountMinorUnits,
        fundsMoved: false,
        custody: false,
        realExecution: false,
      },
    });
    return stored;
  }

  async quoteIntent(input: {
    readonly organizationId: string;
    readonly agentId: string | null;
    readonly paymentIntentId: string;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<PaymentIntent> {
    const intent = await this.requireMutableIntent(input.paymentIntentId, input.organizationId, input.agentId);
    if (intent.status !== 'CREATED' && intent.status !== 'QUOTED' && intent.status !== 'QUOTING') {
      throw new ValidationError(`A payment intent in status ${intent.status} cannot be quoted.`, {
        status: intent.status,
      });
    }

    const policy = await this.requirePolicy(intent.organizationId, intent.agentId);
    await this.assertPolicy(policy, {
      amountMinorUnits: intent.amountMinorUnits,
      sourceAsset: intent.sourceAsset,
      destinationAsset: intent.destinationAsset,
      recipientCode: intent.recipient,
      maxFeeBps: intent.maxFeeBps,
      selectedProviderId: null,
      selectedRouteCostBps: null,
      actor: input.actor,
      requestId: input.requestId,
      paymentIntentId: intent.id,
    });

    const quoting = await this.deps.agentPayments.updateIntent({
      ...intent,
      status: 'QUOTING',
      updatedAt: this.deps.clock.nowIso(),
    });

    const weights = weightsForRoutePreference(quoting.routePreference);
    try {
      const routing = await this.deps.routing.evaluate({
        organizationId: quoting.organizationId,
        sourceAsset: quoting.sourceAsset,
        destinationAsset: quoting.destinationAsset,
        amountMinorUnits: quoting.amountMinorUnits,
        weights,
        actor: input.actor,
        requestId: input.requestId,
      });

      const quoted = routing.routes.map(toQuotedRouteOption);
      const allowed = filterRoutesByPolicy(policy, quoting.maxFeeBps, quoted);
      if (allowed.length === 0) {
        throw new PolicyDeniedError(
          quoted.length === 0 ? 'allowed_providers' : 'maximum_fee',
          quoted.length === 0
            ? 'No priced route is allowed by this agent policy.'
            : 'Every priced route exceeds the maximum fee allowed by policy.',
          {
            pricedRouteCount: quoted.length,
            allowedRouteCount: 0,
          },
        );
      }

      const ranked = allowed.map((route, index) => ({
        ...route,
        rank: index + 1,
        recommended: index === 0,
      }));
      const quoteExpiresAt = earliestExpiry(ranked);
      const quotedIntent = await this.deps.agentPayments.updateIntent({
        ...quoting,
        status: 'QUOTED',
        quotedRoutes: ranked,
        quoteExpiresAt,
        selectedRouteId: null,
        failureReason: null,
        updatedAt: this.deps.clock.nowIso(),
      });

      await this.deps.auditLogger.record({
        type: 'payment.intent.quoted',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: ranked[0]?.providerId ?? null,
        payload: {
          paymentIntentId: quotedIntent.id,
          routeCount: ranked.length,
          quoteExpiresAt,
          aiUsed: false,
          fundsMoved: false,
        },
      });
      return quotedIntent;
    } catch (error) {
      if (error instanceof PolicyDeniedError) {
        await this.recordPolicyDenied(error, input.actor, input.requestId, quoting.id);
        throw error;
      }
      const failed = await this.deps.agentPayments.updateIntent({
        ...quoting,
        status: 'FAILED',
        failureReason: isAppError(error) ? error.message : 'Quote engine failed.',
        updatedAt: this.deps.clock.nowIso(),
      });
      await this.deps.auditLogger.record({
        type: 'payment.intent.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: null,
        payload: {
          paymentIntentId: failed.id,
          reason: failed.failureReason,
          fundsMoved: false,
        },
      });
      if (error instanceof NoRoutesAvailableError) {
        throw error;
      }
      throw error;
    }
  }

  async selectRoute(input: {
    readonly organizationId: string;
    readonly agentId: string | null;
    readonly paymentIntentId: string;
    readonly routeId: string;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<PaymentIntent> {
    const intent = await this.requireMutableIntent(input.paymentIntentId, input.organizationId, input.agentId);
    if (intent.status !== 'QUOTED') {
      throw new ValidationError(`A payment intent in status ${intent.status} cannot select a route.`, {
        status: intent.status,
      });
    }
    this.assertQuoteFresh(intent);

    const selected = intent.quotedRoutes.find((route) => route.routeId === input.routeId);
    if (selected === undefined) {
      throw new ValidationError('Selected route is not one of the quoted options.', {
        routeId: input.routeId,
      });
    }

    const policy = await this.requirePolicy(intent.organizationId, intent.agentId);
    await this.assertPolicy(policy, {
      amountMinorUnits: intent.amountMinorUnits,
      sourceAsset: intent.sourceAsset,
      destinationAsset: intent.destinationAsset,
      recipientCode: intent.recipient,
      maxFeeBps: intent.maxFeeBps,
      selectedProviderId: selected.providerId,
      selectedRouteCostBps: selected.totalCostBps,
      actor: input.actor,
      requestId: input.requestId,
      paymentIntentId: intent.id,
    });

    const routed = await this.deps.agentPayments.updateIntent({
      ...intent,
      status: 'ROUTED',
      selectedRouteId: selected.routeId,
      updatedAt: this.deps.clock.nowIso(),
    });
    await this.deps.auditLogger.record({
      type: 'payment.intent.selected',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
      providerId: selected.providerId,
      payload: {
        paymentIntentId: routed.id,
        routeId: selected.routeId,
        fundsMoved: false,
      },
    });
    return routed;
  }

  async authorizeIntent(input: {
    readonly organizationId: string;
    readonly agentId: string | null;
    readonly paymentIntentId: string;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<PaymentIntent> {
    const intent = await this.requireMutableIntent(input.paymentIntentId, input.organizationId, input.agentId);
    if (intent.status === 'AUTHORIZED') {
      return intent;
    }
    if (intent.status !== 'ROUTED') {
      throw new ValidationError(`A payment intent in status ${intent.status} cannot be authorized.`, {
        status: intent.status,
      });
    }
    this.assertQuoteFresh(intent);

    const selected = selectedRouteOf(intent);
    const policy = await this.requirePolicy(intent.organizationId, intent.agentId);
    await this.assertPolicy(policy, {
      amountMinorUnits: intent.amountMinorUnits,
      sourceAsset: intent.sourceAsset,
      destinationAsset: intent.destinationAsset,
      recipientCode: intent.recipient,
      maxFeeBps: intent.maxFeeBps,
      selectedProviderId: selected.providerId,
      selectedRouteCostBps: selected.totalCostBps,
      actor: input.actor,
      requestId: input.requestId,
      paymentIntentId: intent.id,
    });

    const authorized = await this.deps.agentPayments.updateIntent({
      ...intent,
      status: 'AUTHORIZED',
      authorizedAt: this.deps.clock.nowIso(),
      updatedAt: this.deps.clock.nowIso(),
    });
    await this.deps.auditLogger.record({
      type: 'payment.intent.authorized',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
      providerId: selected.providerId,
      payload: {
        paymentIntentId: authorized.id,
        authorizedAt: authorized.authorizedAt,
        fundsMoved: false,
        custody: false,
        realExecution: false,
      },
    });
    return authorized;
  }

  async simulateIntent(input: {
    readonly organizationId: string;
    readonly agentId: string | null;
    readonly paymentIntentId: string;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<PaymentIntent> {
    const intent = await this.requireMutableIntent(input.paymentIntentId, input.organizationId, input.agentId);
    if (intent.status === 'COMPLETED' && intent.simulation !== null) {
      return intent;
    }
    if (intent.status !== 'AUTHORIZED') {
      throw new ValidationError(`A payment intent in status ${intent.status} cannot be simulated.`, {
        status: intent.status,
      });
    }
    this.assertQuoteFresh(intent);

    const selected = selectedRouteOf(intent);
    const pending = await this.deps.agentPayments.updateIntent({
      ...intent,
      status: 'EXECUTION_PENDING',
      updatedAt: this.deps.clock.nowIso(),
    });

    const simulation = simulateSandboxExecution({
      clock: this.deps.clock,
      ids: this.deps.ids,
      selectedProviderId: selected.providerId,
    });

    const completed = await this.deps.agentPayments.updateIntent({
      ...pending,
      status: 'COMPLETED',
      simulatedAt: simulation.occurredAt,
      simulation,
      fundsMoved: false,
      custody: false,
      realExecution: false,
      updatedAt: this.deps.clock.nowIso(),
    });

    await this.deps.auditLogger.record({
      type: 'payment.intent.simulated',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
      providerId: selected.providerId,
      payload: {
        paymentIntentId: completed.id,
        simulationId: simulation.simulationId,
        simulated: true,
        fundsMoved: false,
        custody: false,
        realExecution: false,
        receipt: simulation.receipt,
      },
    });
    return completed;
  }

  async getIntent(input: {
    readonly organizationId: string;
    readonly agentId: string | null;
    readonly paymentIntentId: string;
  }): Promise<PaymentIntent> {
    const intent = await this.deps.agentPayments.findIntentById(
      input.paymentIntentId,
      input.organizationId,
    );
    if (intent === null || (input.agentId !== null && intent.agentId !== input.agentId)) {
      throw new NotFoundError('PaymentIntent', input.paymentIntentId);
    }
    return this.expireIfNeeded(intent);
  }

  private async requireAgent(agentId: string, organizationId: string): Promise<Agent> {
    const agent = await this.deps.agentPayments.findAgent(agentId, organizationId);
    if (agent === null) {
      throw new NotFoundError('Agent', agentId);
    }
    if (agent.status !== 'active') {
      throw new ValidationError(`Agent "${agentId}" is not active.`, {
        agentId,
        status: agent.status,
      });
    }
    return agent;
  }

  private async requirePolicy(organizationId: string, agentId: string): Promise<PaymentPolicy> {
    const policy = await this.deps.agentPayments.findPolicyByAgent(organizationId, agentId);
    if (policy === null) {
      throw new ValidationError('No payment policy is configured for this agent.', { agentId });
    }
    return policy;
  }

  private async requireMutableIntent(
    paymentIntentId: string,
    organizationId: string,
    agentId: string | null,
  ): Promise<PaymentIntent> {
    const intent = await this.getIntent({ organizationId, agentId, paymentIntentId });
    if (intent.status === 'EXPIRED') {
      throw new QuoteExpiredError('This payment intent has expired.');
    }
    if (intent.status === 'FAILED' || intent.status === 'COMPLETED') {
      throw new ValidationError(`A payment intent in status ${intent.status} cannot be changed.`, {
        status: intent.status,
      });
    }
    return intent;
  }

  private async expireIfNeeded(intent: PaymentIntent): Promise<PaymentIntent> {
    if (intent.status === 'EXPIRED' || intent.status === 'COMPLETED' || intent.status === 'FAILED') {
      return intent;
    }
    const now = this.deps.clock.nowIso();
    if (intent.expiresAt <= now) {
      const expired = await this.deps.agentPayments.updateIntent({
        ...intent,
        status: 'EXPIRED',
        failureReason: 'Payment intent expired.',
        updatedAt: now,
      });
      await this.deps.auditLogger.record({
        type: 'payment.intent.expired',
        actor: 'system',
        requestId: null,
        comparisonId: null,
        providerId: null,
        payload: { paymentIntentId: expired.id, reason: 'expiresAt' },
      });
      return expired;
    }
    return intent;
  }

  private assertQuoteFresh(intent: PaymentIntent): void {
    if (intent.quoteExpiresAt !== null && intent.quoteExpiresAt <= this.deps.clock.nowIso()) {
      throw new QuoteExpiredError('The quoted routes have expired. Request a new quote.');
    }
  }

  private async assertPolicy(
    policy: PaymentPolicy,
    input: {
      readonly amountMinorUnits: string;
      readonly sourceAsset: string;
      readonly destinationAsset: string;
      readonly recipientCode: string;
      readonly maxFeeBps: string | null;
      readonly selectedProviderId: string | null;
      readonly selectedRouteCostBps: string | null;
      readonly actor: string;
      readonly requestId: string;
      readonly paymentIntentId: string | null;
    },
  ): Promise<void> {
    const window = utcDayWindow(this.deps.clock.nowIso());
    const dailySpentMinorUnits = await this.deps.agentPayments.sumDailySpending({
      organizationId: policy.organizationId,
      agentId: policy.agentId,
      asset: policy.dailySpendingAsset,
      fromInclusive: window.start,
      toExclusive: window.end,
      statuses: DAILY_SPENDING_STATUSES,
    });
    try {
      evaluatePaymentPolicy(policy, {
        amountMinorUnits: input.amountMinorUnits,
        sourceAsset: input.sourceAsset,
        destinationAsset: input.destinationAsset,
        recipientCode: input.recipientCode,
        maxFeeBps: input.maxFeeBps,
        selectedProviderId: input.selectedProviderId,
        selectedRouteCostBps: input.selectedRouteCostBps,
        dailySpentMinorUnits,
      });
    } catch (error) {
      if (error instanceof PolicyDeniedError) {
        await this.recordPolicyDenied(
          error,
          input.actor,
          input.requestId,
          input.paymentIntentId,
        );
      }
      throw error;
    }
  }

  private async recordPolicyDenied(
    error: PolicyDeniedError,
    actor: string,
    requestId: string,
    paymentIntentId: string | null,
  ): Promise<void> {
    const payload: JsonObject = {
      rule: String(error.details['rule'] ?? ''),
      message: error.message,
      ...(paymentIntentId === null ? {} : { paymentIntentId }),
    };
    await this.deps.auditLogger.record({
      type: 'payment.policy.denied',
      actor,
      requestId,
      comparisonId: null,
      providerId: null,
      payload,
    });
  }
}

function resolveCreateFields(
  command: CreatePaymentIntentCommand,
  merchants: readonly Merchant[],
): {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly recipient: string;
  readonly purpose: string;
} {
  const parsed =
    command.instruction === undefined ? null : parsePayInstruction(command.instruction, merchants);

  const sourceAsset = assertAssetCode(
    (command.sourceAsset ?? parsed?.sourceAsset)?.toUpperCase() ??
      missing('sourceAsset or an instruction such as "Pay 500 USD to merchant X"'),
  );
  const recipientNeedle = command.recipient ?? parsed?.recipientCode;
  if (recipientNeedle === undefined) {
    missing('recipient or an instruction naming the merchant');
  }
  const merchant = resolveMerchant(recipientNeedle, merchants);
  if (merchant === null) {
    throw new ValidationError(`Unknown recipient "${recipientNeedle}".`, {
      recipient: recipientNeedle,
    });
  }
  if (merchant.status !== 'active') {
    throw new ValidationError(`Recipient "${merchant.recipientCode}" is not active.`, {
      recipient: merchant.recipientCode,
    });
  }

  const destinationAsset = assertAssetCode(
    (command.destinationAsset ?? parsed?.destinationAsset ?? merchant.settlementAsset).toUpperCase(),
  );
  if (sourceAsset === destinationAsset) {
    throw new ValidationError('sourceAsset and destinationAsset must differ.', {
      sourceAsset,
      destinationAsset,
    });
  }

  const amountMinorUnits =
    command.amount === undefined
      ? (parsed?.amountMinorUnits ?? missing('amount or an instruction'))
      : toAssetMinorUnits(sourceAsset, command.amount);

  const purpose =
    command.purpose ??
    command.instruction ??
    `Pay ${sourceAsset} to ${merchant.recipientCode}`;

  return {
    sourceAsset,
    destinationAsset,
    amountMinorUnits,
    recipient: merchant.recipientCode,
    purpose,
  };
}

function missing(what: string): never {
  throw new ValidationError(`${what} is required.`, {});
}

function toQuotedRouteOption(route: ScoredMultiRailRoute): QuotedRouteOption {
  return {
    routeId: route.routeId,
    rank: route.rank,
    recommended: route.recommended,
    providerId: route.provider.id,
    providerName: route.provider.name,
    rail: route.rail,
    totalCostBps: route.totalCostBps.toFixed(),
    expiresAt: route.quote.expiresAt,
  };
}

function earliestExpiry(routes: readonly QuotedRouteOption[]): string | null {
  let earliest: string | null = null;
  for (const route of routes) {
    if (route.expiresAt === null) {
      continue;
    }
    if (earliest === null || route.expiresAt < earliest) {
      earliest = route.expiresAt;
    }
  }
  return earliest;
}

function selectedRouteOf(intent: PaymentIntent): QuotedRouteOption {
  const selectedId = intent.selectedRouteId;
  if (selectedId === null) {
    throw new ValidationError('Select a quoted route before authorizing.', {});
  }
  const selected = intent.quotedRoutes.find((route) => route.routeId === selectedId);
  if (selected === undefined) {
    throw new ValidationError('Selected route is not one of the quoted options.', {
      routeId: selectedId,
    });
  }
  return selected;
}
