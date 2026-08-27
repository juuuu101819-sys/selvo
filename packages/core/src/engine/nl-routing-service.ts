import {
  interpretNaturalLanguagePayment,
  toStructuredNlPaymentIntent,
} from '../domain/payment-instruction.js';
import type { StructuredNlPaymentIntent } from '../domain/nl-intent.js';
import {
  NL_DID_NOT_COMPUTE,
  NL_INTERPRETER,
  NL_PIPELINE_STAGES,
  routePreferenceFromOptimization,
  type NlPipelineStage,
} from '../domain/optimization-preference.js';
import type { PaymentIntent, QuotedRouteOption } from '../domain/agent-payments.js';
import { ValidationError } from '../errors/index.js';
import type { ExecutionIntent } from '../ports/execution-intent.js';
import type {
  AgentPaymentsRepository,
  AuditLogger,
  Clock,
  ExecutionIntentRepository,
  IdGenerator,
} from '../ports/index.js';
import type { AgentPaymentService } from './agent-payment-service.js';

export const NL_ROUTE_PIPELINE: readonly NlPipelineStage[] = NL_PIPELINE_STAGES;
export const NL_INTERPRET_PIPELINE: readonly NlPipelineStage[] = [
  'natural_language',
  'intent_parser',
];

export interface NlInterpretCommand {
  readonly organizationId: string;
  readonly actorAgentId: string | null;
  readonly bodyAgentId: string | undefined;
  readonly instruction: string;
  readonly actor: string;
  readonly requestId: string;
}

export interface NlRouteCommand extends NlInterpretCommand {
  readonly idempotencyKey: string | null;
}

export interface NlRouteResult {
  readonly interpretation: StructuredNlPaymentIntent;
  readonly paymentIntent: PaymentIntent;
  readonly selectedRoute: QuotedRouteOption | null;
  readonly executionIntent: ExecutionIntent;
  readonly pipelineCompleted: readonly NlPipelineStage[];
  readonly interpreter: typeof NL_INTERPRETER;
  readonly aiUsed: false;
  readonly financialsComputedBy: 'routing_engine';
  readonly didNotCompute: typeof NL_DID_NOT_COMPUTE;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly realExecution: false;
  readonly executable: false;
  readonly submitted: false;
}

export interface NlRoutingServiceDependencies {
  readonly agentPayments: AgentPaymentService;
  readonly agentPaymentStore: AgentPaymentsRepository;
  readonly executionIntents: ExecutionIntentRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
}

/**
 * AI-facing natural-language routing.
 *
 * The parser interprets language. The existing payment and multi-rail engines compute quotes.
 * This service never executes a payment.
 */
export class NlRoutingService {
  constructor(private readonly deps: NlRoutingServiceDependencies) {}

  async interpret(command: NlInterpretCommand): Promise<StructuredNlPaymentIntent> {
    const agentId = command.actorAgentId ?? command.bodyAgentId;
    if (agentId === undefined) {
      throw new ValidationError('agentId is required when the caller is not an agent.', {});
    }
    const merchants = await this.deps.agentPaymentStore.listMerchants(command.organizationId);
    const parsed = interpretNaturalLanguagePayment(command.instruction, merchants);
    const interpretation = toStructuredNlPaymentIntent(command.instruction, parsed);
    await this.deps.auditLogger.record({
      type: 'nl.intent.interpreted',
      actor: command.actor,
      requestId: command.requestId,
      comparisonId: null,
      providerId: null,
      payload: {
        agentId,
        sourceAsset: interpretation.sourceAsset,
        destinationAsset: interpretation.destinationAsset,
        recipient: interpretation.recipient,
        amountMinorUnits: interpretation.amount.minorUnits,
        optimizationPreference: interpretation.optimizationPreference,
        interpreter: NL_INTERPRETER,
        aiUsed: false,
        financialsComputedBy: null,
      },
    });
    return interpretation;
  }

  async route(command: NlRouteCommand): Promise<NlRouteResult> {
    const interpretation = await this.interpret(command);
    const routePreference =
      interpretation.optimizationPreference === null
        ? null
        : routePreferenceFromOptimization(interpretation.optimizationPreference);

    const created = await this.deps.agentPayments.createIntent({
      organizationId: command.organizationId,
      actorAgentId: command.actorAgentId,
      bodyAgentId: command.bodyAgentId,
      instruction: command.instruction,
      sourceAsset: undefined,
      destinationAsset: undefined,
      amount: undefined,
      recipient: undefined,
      purpose: command.instruction,
      routePreference,
      maxFeeBps: null,
      expiresAt: undefined,
      idempotencyKey: command.idempotencyKey,
      actor: command.actor,
      requestId: command.requestId,
    });

    let selected = created;
    if (selected.status === 'CREATED' || selected.status === 'QUOTED' || selected.status === 'QUOTING') {
      const quoted = await this.deps.agentPayments.quoteIntent({
        organizationId: command.organizationId,
        agentId: command.actorAgentId,
        paymentIntentId: created.id,
        actor: command.actor,
        requestId: command.requestId,
      });
      const recommended =
        quoted.quotedRoutes.find((route) => route.recommended) ?? quoted.quotedRoutes[0];
      if (recommended === undefined) {
        throw new ValidationError('The routing engine returned no selectable route.', {
          paymentIntentId: quoted.id,
        });
      }
      selected = await this.deps.agentPayments.selectRoute({
        organizationId: command.organizationId,
        agentId: command.actorAgentId,
        paymentIntentId: quoted.id,
        routeId: recommended.routeId,
        actor: command.actor,
        requestId: command.requestId,
      });
    }

    const selectedRoute =
      selected.quotedRoutes.find((route) => route.routeId === selected.selectedRouteId) ??
      selected.quotedRoutes.find((route) => route.recommended) ??
      null;
    if (selected.selectedRouteId === null || selectedRoute === null) {
      throw new ValidationError('The routing engine returned no selectable route.', {
        paymentIntentId: selected.id,
      });
    }

    const existingExecutions = await this.deps.executionIntents.listByOrganization(
      command.organizationId,
      { limit: 50 },
    );
    const replayed = existingExecutions.find(
      (row) =>
        row.routeId === selectedRoute.routeId &&
        row.amountMinorUnits === selected.amountMinorUnits &&
        row.sourceAsset === selected.sourceAsset,
    );
    const executionIntent =
      replayed ??
      (await this.deps.executionIntents.create({
        id: this.deps.ids.generate('eit'),
        organizationId: command.organizationId,
        requestId: command.requestId,
        routeId: selectedRoute.routeId,
        sourceAsset: selected.sourceAsset,
        destinationAsset: selected.destinationAsset,
        amountMinorUnits: selected.amountMinorUnits,
        status: 'recorded',
        executable: false,
        submitted: false,
        quoteExpiresAt: selected.quoteExpiresAt,
        actor: command.actor,
        createdAt: this.deps.clock.nowIso(),
      }));

    await this.deps.auditLogger.record({
      type: 'nl.route.completed',
      actor: command.actor,
      requestId: command.requestId,
      comparisonId: null,
      providerId: selectedRoute.providerId,
      payload: {
        paymentIntentId: selected.id,
        executionIntentId: executionIntent.id,
        routeId: selectedRoute.routeId,
        optimizationPreference: interpretation.optimizationPreference,
        interpreter: NL_INTERPRETER,
        financialsComputedBy: 'routing_engine',
        aiUsed: false,
        fundsMoved: false,
        executable: false,
        submitted: false,
      },
    });

    return {
      interpretation,
      paymentIntent: selected,
      selectedRoute,
      executionIntent,
      pipelineCompleted: NL_ROUTE_PIPELINE,
      interpreter: NL_INTERPRETER,
      aiUsed: false,
      financialsComputedBy: 'routing_engine',
      didNotCompute: NL_DID_NOT_COMPUTE,
      fundsMoved: false,
      custody: false,
      realExecution: false,
      executable: false,
      submitted: false,
    };
  }
}
