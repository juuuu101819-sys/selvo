import type { ExecutionReceiptPayload } from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseOrThrow, verifyExecutionReceiptSchema } from '../http/validation.js';
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
 * Independent verification of a presented execution receipt.
 *
 * Public: the algorithm and public key are on the receipt. The private key never leaves the vault.
 * This endpoint does not look up tenant data and cannot be used to fetch another organization's receipt.
 */
export function registerReceiptVerificationRoute(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
      sandbox: true,
    },
  });

  app.post('/receipts/verify', (request) => {
    const body = parseOrThrow(verifyExecutionReceiptSchema, request.body, 'body');
    const result = container.receipts.verify({
      payload: body.payload as unknown as ExecutionReceiptPayload,
      signature: body.signature,
      publicKeyPem: body.publicKeyPem,
    });
    return envelope(request, result);
  });
}
