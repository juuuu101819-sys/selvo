import { ValidationError } from '../errors/index.js';
import { describe, expect, it } from 'vitest';
import { WireManualPlatformFeeCollector, parseWireReference } from './wire-manual-collector.js';

describe('parseWireReference', () => {
  it('accepts an opaque wire-prefixed reference', () => {
    expect(parseWireReference('wire:20260405-treasury-abc123')).toBe(
      'wire:20260405-treasury-abc123',
    );
  });

  it('rejects values without the wire prefix', () => {
    expect(() => parseWireReference('GB82WEST12345698765432')).toThrow(ValidationError);
  });

  it('rejects IBAN-shaped payloads after the wire prefix', () => {
    expect(() => parseWireReference('wire:GB82WEST12345698765432')).toThrow(ValidationError);
  });

  it('rejects long digit-only payloads after the wire prefix', () => {
    expect(() => parseWireReference('wire:12345678901234')).toThrow(ValidationError);
  });
});

describe('WireManualPlatformFeeCollector', () => {
  it('confirms when paymentMethodToken is a valid wire reference', async () => {
    const collector = new WireManualPlatformFeeCollector();
    const outcome = await collector.collect({
      invoiceId: 'inv_1',
      organizationId: 'org_1',
      currency: 'USD',
      amountMinorUnits: '9900',
      paymentMethodToken: 'wire:treasury-20260405',
      idempotencyKey: 'collect:invoice:inv_1',
    });
    expect(outcome).toMatchObject({
      confirmed: true,
      processorReference: 'wire:treasury-20260405',
      confirmationSource: 'operator_manual',
    });
  });
});
