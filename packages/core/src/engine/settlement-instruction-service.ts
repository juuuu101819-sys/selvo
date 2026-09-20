import { NotFoundError, ValidationError } from '../errors/index.js';
import type { ProviderCredentialVault } from '../crypto/provider-credential-vault.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { AuditLogger } from '../ports/audit.js';
import type { RoutingEvaluationRepository } from '../ports/routing-evaluation.js';
import type { ExecutionIntentRepository } from '../ports/execution-intent.js';
import type { RevenueOriginEnv } from '../domain/revenue-lifecycle.js';
import {
  INSTRUCTION_VERIFICATION_STEPS,
  MERIDIAN_SIGNATURE_ATTESTS,
  MERIDIAN_SIGNATURE_DOES_NOT_ATTEST,
  SETTLEMENT_INSTRUCTION_CANONICALIZATION,
  SETTLEMENT_INSTRUCTION_PURPOSE,
  SETTLEMENT_INSTRUCTION_SIGNATURE_ALGORITHM,
  SETTLEMENT_INSTRUCTION_VERSION,
  assertBoundaryModeNeverDispatches,
  instructionFreshness,
  type BoundaryMode,
  type CustomerCounterSignature,
  type InstructionVenue,
  type SettlementInstructionPayload,
  type SignedSettlementInstruction,
} from '../domain/settlement-instruction.js';
import {
  loadInstructionKeyRing,
  signInstructionPayload,
  verifyInstructionSignature,
  type InstructionKeyRing,
  type InstructionVerificationOutcome,
} from './settlement-instruction-signing.js';
import type { ScoredMultiRailRoute } from './routing-types.js';
import type { SettlementInstructionStore } from '../ports/settlement-instruction.js';
import type { MultiRailRouter } from './routing-engine.js';

/**
 * Generate-and-return settlement instructions (§15, Pattern A).
 *
 * The one thing this service must never grow is a method that sends an instruction somewhere. It
 * composes, signs, persists, and hands back. Dispatch lives in `PartnerInstructionService` behind
 * its own gates and is not reachable from here — there is no import of it in this file, and
 * `settlement-boundary.test.ts` asserts the module graph keeps it that way.
 */

export interface SettlementInstructionDeps {
  readonly store: SettlementInstructionStore;
  readonly executionIntents: ExecutionIntentRepository;
  readonly evaluations: RoutingEvaluationRepository;
  readonly routing: Pick<MultiRailRouter, 'recomputeFromSnapshot'>;
  readonly vault: ProviderCredentialVault;
  readonly audit: AuditLogger;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly originEnv: () => RevenueOriginEnv;
  readonly jwksUri: string;
  /** How long a generated instruction stays usable, capped further by quote expiry. */
  readonly ttlSeconds: number;
}

export interface GenerateInstructionCommand {
  readonly organizationId: string;
  readonly actor: string;
  readonly requestId: string;
  readonly executionIntentId: string;
  readonly routingId: string;
  readonly routeId: string;
  readonly paymentIntentId: string;
  readonly boundaryMode: BoundaryMode;
}

export interface RecordCustomerSignatureCommand {
  readonly organizationId: string;
  readonly actor: string;
  readonly requestId: string;
  readonly instructionId: string;
  readonly signature: CustomerCounterSignature;
}

export class SettlementInstructionService {
  private keyRing: InstructionKeyRing | null = null;

  constructor(private readonly deps: SettlementInstructionDeps) {}

  /** Cached per process; rotation is an operator action that restarts or re-reads the ring. */
  private async keys(): Promise<InstructionKeyRing> {
    if (this.keyRing === null) {
      this.keyRing = await loadInstructionKeyRing(this.deps.vault, this.deps.clock.nowIso());
    }
    return this.keyRing;
  }

  async verificationKeys(): Promise<InstructionKeyRing> {
    return this.keys();
  }

  /** Drop the cache so a rotation performed elsewhere is picked up without a restart. */
  reloadKeys(): void {
    this.keyRing = null;
  }

  /**
   * Compose and sign an instruction for a route the engine already priced.
   *
   * The route is recomputed from the stored routing snapshot rather than taken from the request, so
   * the amounts and provider facts inside the signature are the deterministic engine's and not the
   * caller's (§9-A.6). A caller picks which route; it cannot state what the route costs.
   */
  async generate(command: GenerateInstructionCommand): Promise<SignedSettlementInstruction> {
    assertBoundaryModeNeverDispatches(command.boundaryMode);

    const intent = await this.deps.executionIntents.findById(
      command.executionIntentId,
      command.organizationId,
    );
    if (intent === null) {
      throw new NotFoundError('ExecutionIntent', command.executionIntentId);
    }

    const route = await this.requireRoute(command);
    const now = this.deps.clock.nowIso();
    const quoteExpiresAt = route.quote.expiresAt;
    if (quoteExpiresAt <= now) {
      throw new ValidationError(
        'The quote behind this route has expired. Re-quote before generating an instruction.',
        { failClosed: true, routeId: command.routeId, quoteExpiresAt },
      );
    }

    // Never outlive the quote: an instruction whose price no provider will honour is worse than
    // no instruction, because it carries a signature that makes it look current.
    const ttlExpiry = new Date(
      Date.parse(now) + this.deps.ttlSeconds * 1000,
    ).toISOString();
    const expiresAt = ttlExpiry < quoteExpiresAt ? ttlExpiry : quoteExpiresAt;

    const instructionId = this.deps.ids.generate('msi');
    const payload = this.composePayload({
      instructionId,
      command,
      route,
      createdAt: now,
      expiresAt,
      quoteExpiresAt,
    });
    const keys = await this.keys();
    const signed = signInstructionPayload(payload, keys.active);

    const instruction: SignedSettlementInstruction = {
      id: instructionId,
      organizationId: command.organizationId,
      executionIntentId: command.executionIntentId,
      payload,
      payloadCanonical: signed.payloadCanonical,
      payloadHash: signed.payloadHash,
      signature: signed.signature,
      verification: {
        algorithm: SETTLEMENT_INSTRUCTION_SIGNATURE_ALGORITHM,
        canonicalization: SETTLEMENT_INSTRUCTION_CANONICALIZATION,
        keyId: signed.keyId,
        publicKeyPem: keys.active.publicKeyPem,
        jwksUri: this.deps.jwksUri,
        privateKeyExported: false,
      },
      customerSignature: null,
      expiresAt,
      createdAt: now,
      eligibleVenues: this.venuesFor(route),
      nextSteps: [...INSTRUCTION_VERIFICATION_STEPS],
    };

    const stored = await this.deps.store.create(instruction);

    await this.deps.audit.record({
      type: 'settlement.instruction.generated',
      actor: command.actor,
      organizationId: command.organizationId,
      requestId: command.requestId,
      comparisonId: null,
      providerId: route.provider.id,
      payload: {
        instructionId: stored.id,
        executionIntentId: command.executionIntentId,
        routingId: command.routingId,
        routeId: command.routeId,
        boundaryMode: command.boundaryMode,
        originEnv: payload.originEnv,
        payloadHash: stored.payloadHash,
        signingKeyId: signed.keyId,
        expiresAt,
        // The whole point of the phase, stated in the audit trail rather than inferred from it.
        returnedToCustomer: true,
        transmittedByMeridian: false,
        fundsMoved: false,
      },
    });

    return stored;
  }

  /**
   * Read an instruction, reporting freshness rather than silently serving a stale artifact.
   *
   * Expiry is evaluated now, not at write time, because the interesting case is the instruction
   * that was usable when generated and is not usable any more.
   */
  async read(
    organizationId: string,
    instructionId: string,
  ): Promise<{
    readonly instruction: SignedSettlementInstruction;
    readonly freshness: ReturnType<typeof instructionFreshness>;
  }> {
    const instruction = await this.deps.store.findById(instructionId, organizationId);
    if (instruction === null) {
      throw new NotFoundError('SettlementInstruction', instructionId);
    }
    return {
      instruction,
      freshness: instructionFreshness(instruction, this.deps.clock.nowIso()),
    };
  }

  /**
   * Store the customer's counter-signature.
   *
   * This method ends here on purpose. It writes a column and an audit row; it does not notify a
   * partner, enqueue anything, or change the instruction's usability. Pattern A means the customer
   * executes through their own provider, so the counter-signature is evidence for them, not an
   * instruction to Meridian.
   */
  async recordCustomerSignature(
    command: RecordCustomerSignatureCommand,
  ): Promise<SignedSettlementInstruction> {
    const existing = await this.deps.store.findById(
      command.instructionId,
      command.organizationId,
    );
    if (existing === null) {
      throw new NotFoundError('SettlementInstruction', command.instructionId);
    }
    if (existing.customerSignature !== null) {
      throw new ValidationError('This instruction already carries a customer signature.', {
        instructionId: command.instructionId,
        failClosed: true,
      });
    }

    const updated = await this.deps.store.attachCustomerSignature(
      command.instructionId,
      command.organizationId,
      command.signature,
    );

    await this.deps.audit.record({
      type: 'settlement.instruction.customer_signed',
      actor: command.actor,
      organizationId: command.organizationId,
      requestId: command.requestId,
      comparisonId: null,
      providerId: null,
      payload: {
        instructionId: command.instructionId,
        algorithm: command.signature.algorithm,
        customerKeyId: command.signature.keyId,
        signedAt: command.signature.signedAt,
        // A counter-signed instruction is still only an artifact in the customer's hands.
        triggeredDispatch: false,
        transmittedByMeridian: false,
        fundsMoved: false,
      },
    });

    return updated;
  }

  /** Verify a signature the way an external party would, using the published ring. */
  async verify(input: {
    readonly payload: SettlementInstructionPayload;
    readonly signature: string;
    readonly keyId: string;
    readonly payloadCanonical?: string | undefined;
  }): Promise<InstructionVerificationOutcome> {
    const keys = await this.keys();
    return verifyInstructionSignature({
      payload: input.payload,
      signature: input.signature,
      keyId: input.keyId,
      keys: keys.verification,
      ...(input.payloadCanonical === undefined
        ? {}
        : { payloadCanonical: input.payloadCanonical }),
    });
  }

  private async requireRoute(
    command: GenerateInstructionCommand,
  ): Promise<ScoredMultiRailRoute & { readonly competingRouteCount: number }> {
    const stored = await this.deps.evaluations.findById(command.routingId);
    if (stored === null || stored.organizationId !== command.organizationId) {
      throw new NotFoundError('RoutingEvaluation', command.routingId);
    }
    const routing = this.deps.routing.recomputeFromSnapshot(stored.snapshot);
    const route = routing.routes.find(
      (entry: ScoredMultiRailRoute) => entry.routeId === command.routeId,
    );
    if (route === undefined) {
      throw new ValidationError('Selected route is not part of this routing evaluation.', {
        failClosed: true,
        routingId: command.routingId,
        routeId: command.routeId,
      });
    }
    return { ...route, competingRouteCount: routing.routes.length };
  }

  private composePayload(input: {
    readonly instructionId: string;
    readonly command: GenerateInstructionCommand;
    readonly route: ScoredMultiRailRoute & { readonly competingRouteCount: number };
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly quoteExpiresAt: string;
  }): SettlementInstructionPayload {
    const { route } = input;
    return {
      instructionVersion: SETTLEMENT_INSTRUCTION_VERSION,
      purpose: SETTLEMENT_INSTRUCTION_PURPOSE,
      instructionId: input.instructionId,
      organizationId: input.command.organizationId,
      boundaryMode: input.command.boundaryMode,
      originEnv: this.deps.originEnv(),
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      quoteExpiresAt: input.quoteExpiresAt,
      route: {
        routingId: input.command.routingId,
        routeId: route.routeId,
        providerId: route.provider.id,
        providerName: route.provider.name,
        providerLicensing: route.provider.licensing,
        rail: route.rail,
        railFamily: route.railFamily,
        category: route.category,
        conversionKind: route.conversionKind,
        legs: route.hops.map((hop, index) => ({ sequence: index + 1, hop })),
        sourceAsset: route.sendAmount.asset,
        destinationAsset: route.deliveredAmount.asset,
        sendMinorUnits: route.sendAmount.minorUnits.toString(),
        sendExponent: route.sendAmount.toJSON().exponent,
        deliveredMinorUnits: route.deliveredAmount.minorUnits.toString(),
        deliveredExponent: route.deliveredAmount.toJSON().exponent,
        indicatedRate: route.indicatedRate.toString(),
        effectiveRate: route.effectiveRate.toString(),
        recommended: route.recommended,
        rank: route.rank,
        competingRouteCount: route.competingRouteCount,
        bestExecutionRationaleHash: route.bestExecution.rationaleHash,
      },
      costs: {
        totalCostMinorUnits: route.breakdown.totalCost.minorUnits.toString(),
        totalCostAsset: route.breakdown.totalCost.asset,
        totalCostBps: route.totalCostBps.toString(),
        providerFeeMinorUnits: route.breakdown.providerFee.minorUnits.toString(),
        platformFeeMinorUnits: route.breakdown.platformFee.minorUnits.toString(),
        networkFeeMinorUnits: route.breakdown.networkFee.minorUnits.toString(),
        spreadBps: route.spreadBps.toString(),
        slippageBps: route.slippageBps.toString(),
      },
      authorization: {
        paymentIntentId: input.command.paymentIntentId,
        executionIntentId: input.command.executionIntentId,
        policyEvaluated: true,
      },
      compliance: {
        eligible: route.compliance.eligible,
        kycRequired: route.compliance.kycRequired,
        sanctionsScreeningRequired: route.compliance.sanctionsScreeningRequired,
        licensing: route.compliance.licensing,
        jurisdictions: [...route.compliance.jurisdictions],
        notes: route.compliance.notes,
      },
      signatureAttests: MERIDIAN_SIGNATURE_ATTESTS,
      signatureDoesNotAttest: MERIDIAN_SIGNATURE_DOES_NOT_ATTEST,
      meridianTransmits: false,
      meridianIsPayer: false,
      fundsMoved: false,
      custody: false,
      transferSigned: false,
      meridianKeysUsed: false,
    };
  }

  /**
   * Where the customer can take this artifact.
   *
   * The quoted provider is listed because it is the one that priced the route. Listing it is not a
   * referral and not an introduction: the customer needs their own relationship, which the flag on
   * every entry states rather than leaves implied.
   */
  private venuesFor(route: ScoredMultiRailRoute): readonly InstructionVenue[] {
    // Both boundary modes name the same venue. Under Pattern A the customer takes the artifact
    // there themselves; under Pattern B they already contracted that partner and need the artifact
    // to say which one. Neither case is Meridian handing anything over.
    return [
      {
        providerId: route.provider.id,
        providerName: route.provider.name,
        licensing: route.provider.licensing,
        jurisdictions: [...route.provider.jurisdictions],
        customerMustHaveOwnRelationship: true,
      },
    ];
  }
}
