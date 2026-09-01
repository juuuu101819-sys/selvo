import { ExecutionPartnerRegistry } from '@meridian/core';
import { describe, expect, it } from 'vitest';
import {
  SANDBOX_PARTNER_BANK_FX_ID,
  SANDBOX_PARTNER_PSP_FX_ID,
  SANDBOX_PARTNER_STABLECOIN_VASP_ID,
  createSandboxExecutionPartners,
} from './create-mocks.js';
import { FixedClock, noopLogger } from '@meridian/core';

describe('createSandboxExecutionPartners', () => {
  it('returns bank-FX, PSP-FX and stablecoin-VASP mocks, never a live adapter', () => {
    const partners = createSandboxExecutionPartners();
    expect(partners.map((partner) => partner.capabilities.partnerId).sort()).toEqual([
      SANDBOX_PARTNER_BANK_FX_ID,
      SANDBOX_PARTNER_PSP_FX_ID,
      SANDBOX_PARTNER_STABLECOIN_VASP_ID,
    ]);
    expect(partners.every((partner) => partner.kind === 'sandbox_mock')).toBe(true);
    expect(partners.every((partner) => partner.capabilities.live === false)).toBe(true);
    const registry = ExecutionPartnerRegistry.create(partners, { liveEnabled: false });
    expect(registry.admitsKind('live')).toBe(false);
  });
});

describe('SandboxExecutionPartner', () => {
  it('quotes with executable false and never reports funds moved', async () => {
    const partner = createSandboxExecutionPartners()[0];
    if (partner === undefined) {
      throw new Error('expected a mock partner');
    }
    const quote = await partner.quote(
      {
        sourceAsset: 'USD',
        targetAsset: 'KRW',
        amountMinorUnits: '10000000',
        requestedAt: '2026-03-01T09:00:00.000Z',
      },
      {
        clock: new FixedClock('2026-03-01T09:00:00.000Z'),
        logger: noopLogger,
        requestId: 'req',
        signal: undefined,
      },
    );
    expect(quote.executable).toBe(false);
    expect(quote.metadata['fundsMoved']).toBe(false);
  });
});
