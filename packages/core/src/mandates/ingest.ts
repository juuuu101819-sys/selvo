import { MandateRejectedError, ValidationError } from '../errors/index.js';
import { parseAp2Mandate } from './ap2.js';
import { parseMppMandate } from './mpp.js';
import { parseX402ScopeRequest } from './x402.js';
import type { ParsedMandate } from './types.js';

export type VerifyMandateBody =
  | { readonly format: 'ap2'; readonly credential?: unknown; readonly [key: string]: unknown }
  | { readonly format: 'x402'; readonly challengeId?: string; readonly authorization?: unknown; readonly [key: string]: unknown }
  | { readonly format: 'mpp'; readonly session?: unknown; readonly [key: string]: unknown };

export function readFormat(body: unknown): 'ap2' | 'x402' | 'mpp' {
  if (body === null || typeof body !== 'object') {
    throw new ValidationError('Mandate body must be a JSON object.', { failClosed: true });
  }
  const format = (body as Record<string, unknown>)['format'];
  if (format === 'ap2' || format === 'x402' || format === 'mpp') {
    return format;
  }
  const credential = (body as Record<string, unknown>)['credential'];
  if (credential !== undefined) {
    return 'ap2';
  }
  throw new MandateRejectedError(
    'unsupported_format',
    'Unsupported mandate format. Use ap2, x402, or mpp.',
    { format: format ?? null },
  );
}

export function parseSignedMandate(body: unknown, nowIso: string): ParsedMandate {
  const format = readFormat(body);
  if (format === 'ap2') {
    return parseAp2Mandate(body, nowIso);
  }
  if (format === 'mpp') {
    return parseMppMandate(body, nowIso);
  }
  throw new MandateRejectedError(
    'challenge_required',
    'x402 mandates require a 402 challenge before authorization.',
  );
}

export { parseX402ScopeRequest };
