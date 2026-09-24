import { ValidationError } from '../errors/index.js';
import type { CollectionConfirmationSource } from '../domain/collection.js';
import type { CollectionOutcome, CollectionRequest, PlatformFeeCollector } from './payment-collector.js';

/** Prefix for operator-confirmed wire references. Never a bank account or card number. */
export const WIRE_REFERENCE_PREFIX = 'wire:' as const;

const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i;
const WIRE_REFERENCE_BODY = /^[A-Za-z0-9._-]{4,126}$/;

/**
 * Validate an opaque wire confirmation reference.
 *
 * Deliberately rejects IBAN-shaped and long digit-only payloads so treasury ops paste a internal
 * reference, not raw banking credentials (§18.5 non-custodial collection).
 */
export function parseWireReference(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(WIRE_REFERENCE_PREFIX)) {
    throw new ValidationError(
      'Wire reference must start with "wire:" followed by an opaque treasury reference.',
      { field: 'wireReference' },
    );
  }
  const body = trimmed.slice(WIRE_REFERENCE_PREFIX.length);
  if (!WIRE_REFERENCE_BODY.test(body)) {
    throw new ValidationError(
      'Wire reference must be wire: followed by 4–126 alphanumeric, dot, underscore, or hyphen characters.',
      { field: 'wireReference' },
    );
  }
  if (IBAN_PATTERN.test(body)) {
    throw new ValidationError('Wire reference must not resemble an IBAN.', { field: 'wireReference' });
  }
  if (/^\d{8,}$/.test(body)) {
    throw new ValidationError(
      'Wire reference must not be a bare account number.',
      { field: 'wireReference' },
    );
  }
  return trimmed;
}

/**
 * Confirms platform-fee invoices against operator-verified wire deposits.
 *
 * Does not initiate transfers or hold customer funds. {@link collect} treats
 * {@link CollectionRequest.paymentMethodToken} as an opaque `wire:` reference when present; the
 * primary path is {@link CollectionService.confirmWireInvoice}, which bypasses {@link collect}.
 */
export class WireManualPlatformFeeCollector implements PlatformFeeCollector {
  readonly kind = 'wire_manual';
  readonly collectionEnabled = true;

  collect(request: CollectionRequest): Promise<CollectionOutcome> {
    try {
      const processorReference = parseWireReference(request.paymentMethodToken);
      return Promise.resolve(confirmedWireOutcome(processorReference));
    } catch (error) {
      if (error instanceof ValidationError) {
        return Promise.resolve({
          confirmed: false,
          processorReference: null,
          confirmationSource: null,
          failureReason: error.message,
        });
      }
      throw error;
    }
  }
}

function confirmedWireOutcome(processorReference: string): CollectionOutcome {
  const confirmationSource: CollectionConfirmationSource = 'operator_manual';
  return {
    confirmed: true,
    processorReference,
    confirmationSource,
    failureReason: null,
  };
}
