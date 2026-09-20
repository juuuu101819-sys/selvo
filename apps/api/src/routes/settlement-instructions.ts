import {
  INSTRUCTION_VERIFICATION_STEPS,
  MERIDIAN_SIGNATURE_ATTESTS,
  MERIDIAN_SIGNATURE_DOES_NOT_ATTEST,
  SETTLEMENT_INSTRUCTION_CANONICALIZATION,
  SETTLEMENT_INSTRUCTION_SIGNATURE_ALGORITHM,
  SETTLEMENT_INSTRUCTION_VERSION,
  instructionJwks,
  serializeSettlementInstruction,
  type InstructionVerificationDto,
  type SettlementInstructionDto,
  type SettlementInstructionPayload,
  type SettlementJwksDto,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContainer } from '../container.js';
import { capabilityPreHandler, requireCapability } from '../http/require-organization.js';
import {
  customerSignatureSchema,
  generateSettlementInstructionSchema,
  parseOrThrow,
  verifySettlementInstructionSchema,
} from '../http/validation.js';

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

/**
 * Settlement instructions — generate and return (§15, Pattern A).
 *
 * Every handler here ends by sending a response. None of them calls a partner, enqueues work, or
 * touches `container.partnerInstructions`. That is the entire point of the phase: the customer
 * receives a signed artifact and acts on it through their own licensed provider relationship, and
 * Meridian's involvement is over when the response is written.
 *
 * `POST /executions` is unchanged and still the audited 501. The Pattern C machinery behind it
 * keeps every gate it had; nothing in this file weakens or bypasses one, because nothing in this
 * file can reach it.
 */
export function registerSettlementInstructionRoutes(
  app: FastifyInstance,
  container: AppContainer,
): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  /**
   * Generate a signed instruction and hand it back.
   *
   * Named `generate` rather than anything resembling `submit` or `send`: the verb is the contract.
   * A 201 here means an artifact exists and the customer has it, not that a payment is in flight.
   */
  app.post(
    '/settlement/instructions',
    { preHandler: [capabilityPreHandler('transaction:create')] },
    async (request, reply) => {
      const principal = requireCapability(request, 'transaction:create');
      const body = parseOrThrow(generateSettlementInstructionSchema, request.body, 'body');

      const instruction = await container.settlementInstructions.generate({
        organizationId: principal.organizationId,
        actor: principal.actor,
        requestId: request.id,
        executionIntentId: body.executionIntentId,
        routingId: body.routingId,
        routeId: body.routeId,
        paymentIntentId: body.paymentIntentId,
        boundaryMode: body.boundaryMode,
      });

      // Freshly generated, so it is usable by construction; `generate` refuses an expired quote.
      return reply.status(201).send(
        envelope<SettlementInstructionDto>(
          request,
          serializeSettlementInstruction(instruction, { usable: true, reason: null }),
        ),
      );
    },
  );

  app.get(
    '/settlement/instructions/:id',
    { preHandler: [capabilityPreHandler('transaction:create')] },
    async (request) => {
      const principal = requireCapability(request, 'transaction:create');
      const { id } = request.params as { readonly id: string };
      const { instruction, freshness } = await container.settlementInstructions.read(
        principal.organizationId,
        id,
      );
      return envelope<SettlementInstructionDto>(
        request,
        serializeSettlementInstruction(instruction, freshness),
      );
    },
  );

  /**
   * Store the customer's counter-signature.
   *
   * Returns the instruction with the signature attached and nothing else changed. There is no
   * side effect to describe in this comment, which is the property `settlement-boundary.test.ts`
   * asserts rather than trusts.
   */
  app.post(
    '/settlement/instructions/:id/customer-signature',
    { preHandler: [capabilityPreHandler('transaction:create')] },
    async (request) => {
      const principal = requireCapability(request, 'transaction:create');
      const { id } = request.params as { readonly id: string };
      const body = parseOrThrow(customerSignatureSchema, request.body, 'body');

      const instruction = await container.settlementInstructions.recordCustomerSignature({
        organizationId: principal.organizationId,
        actor: principal.actor,
        requestId: request.id,
        instructionId: id,
        signature: {
          algorithm: body.algorithm,
          signature: body.signature,
          keyId: body.keyId,
          signedAt: body.signedAt,
          triggeredDispatch: false,
        },
      });

      const { freshness } = await container.settlementInstructions.read(
        principal.organizationId,
        id,
      );
      return envelope<SettlementInstructionDto>(
        request,
        serializeSettlementInstruction(instruction, freshness),
      );
    },
  );

  /**
   * Verify a signature server-side.
   *
   * A convenience, not the authority: the artifact carries everything needed to verify offline,
   * and a customer who only ever checks signatures by asking the signer has not verified anything.
   * `nextSteps` on every instruction describes the offline procedure, and the JWKS below is what
   * makes it possible.
   */
  app.post('/settlement/instructions/verify', async (request) => {
    const body = parseOrThrow(verifySettlementInstructionSchema, request.body, 'body');
    const outcome = await container.settlementInstructions.verify({
      payload: body.payload as unknown as SettlementInstructionPayload,
      signature: body.signature,
      keyId: body.keyId,
      ...(body.payloadCanonical === undefined
        ? {}
        : { payloadCanonical: body.payloadCanonical }),
    });
    return envelope<InstructionVerificationDto>(request, {
      valid: outcome.valid,
      payloadHash: outcome.payloadHash,
      keyId: outcome.keyId,
      reason: outcome.reason,
      fundsMoved: false,
    });
  });

  /**
   * Publish the verification keys.
   *
   * Public so a customer's provider can verify without holding a Meridian credential — requiring
   * one would make the artifact unusable by exactly the party it is meant for. Retired keys stay
   * listed so instructions signed before a rotation keep verifying until they expire.
   */
  app.get('/settlement/keys', async (request) => {
    const ring = await container.settlementInstructions.verificationKeys();
    return envelope<SettlementJwksDto>(request, instructionJwks(ring.verification));
  });

  /**
   * What the signature means and how to check it, as a fetchable document.
   *
   * The same text is embedded in every signed payload. Publishing it separately gives an
   * integrator something to read before they have an artifact in hand.
   */
  app.get('/settlement/verification', (request) =>
    envelope(request, {
      instructionVersion: SETTLEMENT_INSTRUCTION_VERSION,
      algorithm: SETTLEMENT_INSTRUCTION_SIGNATURE_ALGORITHM,
      canonicalization: SETTLEMENT_INSTRUCTION_CANONICALIZATION,
      signatureAttests: MERIDIAN_SIGNATURE_ATTESTS,
      signatureDoesNotAttest: MERIDIAN_SIGNATURE_DOES_NOT_ATTEST,
      steps: INSTRUCTION_VERIFICATION_STEPS,
      boundary: {
        meridianTransmits: false,
        meridianIsPayer: false,
        executionsEndpoint: '501 — Meridian does not execute transactions.',
      },
    }),
  );
}
