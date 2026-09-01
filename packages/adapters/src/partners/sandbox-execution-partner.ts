import {
  conversionKindOf,
  partnerSupportsRequest,
  type ExecutionPartner,
  type ExecutionPartnerCapabilities,
  type NormalizedQuote,
  type NormalizedQuoteRequest,
  type PartnerDispatchResult,
  type PartnerExecutionContext,
  type PartnerWebhookEvent,
  type ProviderContext,
  type ProviderDescriptor,
  type SignedExecutionInstruction,
  advanceSandboxSimulation,
  applySandboxWebhook,
  initialSandboxDispatch,
  type SandboxSimulationState,
} from '@meridian/core';

export interface SandboxExecutionPartnerOptions {
  readonly extraDelayPolls?: number;
  readonly failDispatch?: boolean;
}

interface TrackedSimulation {
  readonly instruction: SignedExecutionInstruction;
  state: SandboxSimulationState;
}

/**
 * In-process mock execution partner.
 *
 * Forwards a caller-signed instruction and reports sandbox status. Settlement is simulated as the
 * partner paying the beneficiary. Meridian never holds the funds, a key, or a wallet.
 */
export class SandboxExecutionPartner implements ExecutionPartner {
  readonly kind = 'sandbox_mock' as const;
  private readonly simulations = new Map<string, TrackedSimulation>();
  private readonly extraDelayPolls: number;
  private readonly failDispatch: boolean;

  constructor(
    readonly descriptor: ProviderDescriptor,
    readonly capabilities: ExecutionPartnerCapabilities,
    options: SandboxExecutionPartnerOptions = {},
  ) {
    this.extraDelayPolls = options.extraDelayPolls ?? 0;
    this.failDispatch = options.failDispatch === true;
  }

  async quote(request: NormalizedQuoteRequest, context: ProviderContext): Promise<NormalizedQuote> {
    await Promise.resolve();
    const timestamp = context.clock.nowIso();
    return {
      providerId: this.capabilities.quotedProviderId,
      timestamp,
      expiresAt: new Date(Date.parse(timestamp) + 120_000).toISOString(),
      quoteReference: `${this.capabilities.partnerId}-quote`,
      conversionKind: conversionKindOf(request.sourceAsset, request.targetAsset),
      sourceAsset: request.sourceAsset,
      targetAsset: request.targetAsset,
      amountMinorUnits: request.amountMinorUnits,
      indicatedRate: '1290',
      midMarketRate: '1300',
      fees: [],
      settlement: {
        p50Seconds: 3_600,
        p95Seconds: 7_200,
        businessDaysOnly: false,
        cutoffUtc: null,
        notes: 'Sandbox execution-partner quote. Indicative only; Meridian does not settle.',
      },
      liquidity: {
        availableDepthMinorUnits: null,
        venue: this.capabilities.partnerId,
        chainId: null,
      },
      slippage: { kind: 'none' },
      reliabilityScore: '0.99',
      executable: false,
      chainId: null,
      metadata: { sandboxPartner: true, fundsMoved: false, meridianKeysUsed: false },
    };
  }

  async dispatchInstruction(
    instruction: SignedExecutionInstruction,
    context: PartnerExecutionContext,
  ): Promise<PartnerDispatchResult> {
    await Promise.resolve();
    if (
      !partnerSupportsRequest(this.capabilities, {
        sourceAsset: instruction.sourceAsset,
        destinationAsset: instruction.destinationAsset,
        amountMinorUnits: instruction.amountMinorUnits,
        atIso: context.clock.nowIso(),
      })
    ) {
      return this.result(context.executionRef, {
        status: 'failed',
        filledMinorUnits: '0',
        failureCode: 'capability_mismatch',
        polls: 0,
      });
    }
    const state = initialSandboxDispatch({
      scenario: instruction.sandboxScenario,
      failDispatch: this.failDispatch,
      amountMinorUnits: instruction.amountMinorUnits,
    });
    this.simulations.set(context.executionRef, { instruction, state });
    return this.result(context.executionRef, state);
  }

  async getExecutionStatus(
    ref: string,
    _context: PartnerExecutionContext,
  ): Promise<PartnerDispatchResult> {
    await Promise.resolve();
    const tracked = this.simulations.get(ref);
    if (tracked === undefined) {
      return this.result(ref, {
        status: 'failed',
        filledMinorUnits: '0',
        failureCode: 'unknown_execution_ref',
        polls: 0,
      });
    }
    const next = advanceSandboxSimulation({
      state: tracked.state,
      scenario: tracked.instruction.sandboxScenario,
      extraDelayPolls: this.extraDelayPolls,
      amountMinorUnits: tracked.instruction.amountMinorUnits,
    });
    tracked.state = next;
    return this.result(ref, next);
  }

  async handleWebhook(
    event: PartnerWebhookEvent,
    _context: PartnerExecutionContext,
  ): Promise<PartnerDispatchResult> {
    await Promise.resolve();
    const tracked = this.simulations.get(event.executionRef);
    if (tracked === undefined) {
      return this.result(event.executionRef, {
        status: 'failed',
        filledMinorUnits: '0',
        failureCode: 'unknown_execution_ref',
        polls: 0,
      });
    }
    const next = applySandboxWebhook({
      state: tracked.state,
      status: event.status,
      filledMinorUnits: event.filledMinorUnits,
      reasonCode: event.reasonCode,
      amountMinorUnits: tracked.instruction.amountMinorUnits,
    });
    tracked.state = next;
    return this.result(event.executionRef, next);
  }

  private result(executionRef: string, state: SandboxSimulationState): PartnerDispatchResult {
    return {
      executionRef,
      partnerId: this.capabilities.partnerId,
      status: state.status,
      filledMinorUnits: state.filledMinorUnits,
      failureCode: state.failureCode,
      fundsMoved: false,
      custody: false,
      meridianKeysUsed: false,
    };
  }
}
