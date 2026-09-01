import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN_HOURS, type ExecutionPartner } from '../ports/execution-partner.js';
import { buildNormalizedQuote, buildProviderDescriptor } from '../testing/index.js';
import { ExecutionPartnerRegistry } from './execution-partner-registry.js';

function stubPartner(
  overrides: {
    readonly partnerId?: string;
    readonly kind?: 'sandbox_mock' | 'live';
    readonly live?: boolean;
    readonly quotedProviderId?: string;
    readonly corridors?: readonly { readonly source: string; readonly destination: string }[];
  } = {},
): ExecutionPartner {
  const partnerId = overrides.partnerId ?? 'sandbox-partner-bank-fx';
  const kind = overrides.kind ?? 'sandbox_mock';
  const live = overrides.live ?? kind === 'live';
  return {
    kind,
    descriptor: buildProviderDescriptor({
      id: partnerId,
      name: partnerId,
      licensing: live ? 'licensed_partner' : 'unlicensed_sandbox',
    }),
    capabilities: {
      partnerId,
      kind,
      rail: 'bank_fx',
      quotedProviderId: overrides.quotedProviderId ?? 'sandbox-northgate-bank',
      corridors: overrides.corridors ?? [{ source: 'USD', destination: 'KRW' }],
      currencies: ['USD', 'KRW'],
      minAmountMinorUnits: '0',
      maxAmountMinorUnits: '100000000000',
      maxAmountAsset: 'USD',
      operatingHours: ALWAYS_OPEN_HOURS,
      licenses: live ? ['imagined_license'] : ['sandbox_mock'],
      sandbox: !live,
      live,
    },
    quote: () => Promise.resolve(buildNormalizedQuote({ providerId: partnerId })),
    dispatchInstruction: () =>
      Promise.resolve({
        executionRef: 'pex_1',
        partnerId,
        status: 'accepted',
        filledMinorUnits: '0',
        failureCode: null,
        fundsMoved: false,
        custody: false,
        meridianKeysUsed: false,
      }),
    getExecutionStatus: () =>
      Promise.resolve({
        executionRef: 'pex_1',
        partnerId,
        status: 'settled',
        filledMinorUnits: '100',
        failureCode: null,
        fundsMoved: false,
        custody: false,
        meridianKeysUsed: false,
      }),
    handleWebhook: () =>
      Promise.resolve({
        executionRef: 'pex_1',
        partnerId,
        status: 'settled',
        filledMinorUnits: '100',
        failureCode: null,
        fundsMoved: false,
        custody: false,
        meridianKeysUsed: false,
      }),
  };
}

describe('ExecutionPartnerRegistry', () => {
  it('admits sandbox mocks when PARTNER_LIVE_ENABLED is false', () => {
    const registry = ExecutionPartnerRegistry.create([stubPartner()], { liveEnabled: false });
    expect(registry.all()).toHaveLength(1);
    expect(registry.admitsKind('live')).toBe(false);
    expect(registry.exclusions).toEqual([]);
  });

  it('excludes live partners when PARTNER_LIVE_ENABLED is false', () => {
    const registry = ExecutionPartnerRegistry.create(
      [
        stubPartner(),
        stubPartner({ partnerId: 'live-imagined-bank', kind: 'live', live: true }),
      ],
      { liveEnabled: false },
    );
    expect(registry.get('sandbox-partner-bank-fx')).not.toBeNull();
    expect(registry.get('live-imagined-bank')).toBeNull();
    expect(registry.exclusions).toEqual([
      expect.objectContaining({
        partnerId: 'live-imagined-bank',
        reason: expect.stringContaining('PARTNER_LIVE_ENABLED=false'),
      }),
    ]);
    expect(registry.admitsKind('live')).toBe(false);
  });

  it('still refuses live partners when the flag is true because none are implemented', () => {
    const registry = ExecutionPartnerRegistry.create(
      [stubPartner({ partnerId: 'live-imagined-bank', kind: 'live', live: true })],
      { liveEnabled: true },
    );
    expect(registry.all()).toHaveLength(0);
    expect(registry.exclusions[0]?.reason).toMatch(/not implemented/);
  });

  it('filters eligible partners by corridor', () => {
    const registry = ExecutionPartnerRegistry.create(
      [
        stubPartner({
          partnerId: 'yen-only',
          quotedProviderId: 'restricted',
          corridors: [{ source: 'JPY', destination: 'INR' }],
        }),
        stubPartner(),
      ],
      { liveEnabled: false },
    );
    const eligible = registry.eligible({
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      atIso: '2026-03-01T09:00:00.000Z',
    });
    expect(eligible.map((partner) => partner.capabilities.partnerId)).toEqual([
      'sandbox-partner-bank-fx',
    ]);
  });
});
