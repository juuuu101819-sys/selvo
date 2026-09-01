import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN_HOURS } from '../ports/execution-partner.js';
import { hashExecutionInstruction, hoursOpen, partnerSupportsRequest } from './partner-capability.js';

const baseCapabilities = {
  partnerId: 'sandbox-partner-bank-fx',
  kind: 'sandbox_mock' as const,
  rail: 'bank_fx' as const,
  quotedProviderId: 'sandbox-northgate-bank',
  corridors: [{ source: 'USD', destination: 'KRW' }],
  currencies: ['USD', 'KRW'],
  minAmountMinorUnits: '100000',
  maxAmountMinorUnits: '1000000000',
  maxAmountAsset: 'USD',
  operatingHours: ALWAYS_OPEN_HOURS,
  licenses: ['sandbox_mock_bank_fx'],
  sandbox: true,
  live: false,
};

describe('partnerSupportsRequest', () => {
  it('admits a matching USD→KRW notional inside limits', () => {
    expect(
      partnerSupportsRequest(baseCapabilities, {
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amountMinorUnits: '10000000',
        atIso: '2026-03-01T09:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('excludes a corridor the partner does not list', () => {
    expect(
      partnerSupportsRequest(baseCapabilities, {
        sourceAsset: 'USD',
        destinationAsset: 'JPY',
        amountMinorUnits: '10000000',
        atIso: '2026-03-01T09:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('excludes a notional above the partner limit', () => {
    expect(
      partnerSupportsRequest(baseCapabilities, {
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amountMinorUnits: '1000000001',
        atIso: '2026-03-01T09:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('treats a star corridor as covering every pair', () => {
    expect(
      partnerSupportsRequest(
        { ...baseCapabilities, corridors: [{ source: '*', destination: '*' }], currencies: ['*'] },
        {
          sourceAsset: 'KRW',
          destinationAsset: 'USD',
          amountMinorUnits: '10000000',
          atIso: '2026-03-01T09:00:00.000Z',
        },
      ),
    ).toBe(true);
  });

  it('excludes live capabilities even when the corridor matches', () => {
    expect(
      partnerSupportsRequest(
        { ...baseCapabilities, kind: 'live', live: true, sandbox: false },
        {
          sourceAsset: 'USD',
          destinationAsset: 'KRW',
          amountMinorUnits: '10000000',
          atIso: '2026-03-01T09:00:00.000Z',
        },
      ),
    ).toBe(false);
  });

  it('excludes outside operating hours', () => {
    const weekdayHours = {
      timezone: 'UTC' as const,
      daysOfWeek: [1, 2, 3, 4, 5],
      startUtcMinutes: 9 * 60,
      endUtcMinutes: 17 * 60,
    };
    expect(hoursOpen(weekdayHours, '2026-03-01T09:00:00.000Z')).toBe(false);
    expect(hoursOpen(weekdayHours, '2026-03-02T10:00:00.000Z')).toBe(true);
    expect(
      partnerSupportsRequest(
        { ...baseCapabilities, operatingHours: weekdayHours },
        {
          sourceAsset: 'USD',
          destinationAsset: 'KRW',
          amountMinorUnits: '10000000',
          atIso: '2026-03-01T09:00:00.000Z',
        },
      ),
    ).toBe(false);
  });
});

describe('hashExecutionInstruction', () => {
  it('hashes the instruction without storing the raw signature', () => {
    const hashed = hashExecutionInstruction({
      quoteReference: 'q1',
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      beneficiaryRef: 'merchant-x',
      signedAt: '2026-03-01T09:00:00.000Z',
      signature: 'caller-supplied-signature',
      sandboxScenario: 'settle',
    });
    expect(hashed.instructionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashed.signatureHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashed.instructionHash).not.toContain('caller-supplied');
  });
});
