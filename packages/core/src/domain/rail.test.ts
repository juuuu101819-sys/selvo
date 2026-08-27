import { describe, expect, it } from 'vitest';
import {
  RAIL_FAMILY_REGISTRY,
  RAIL_REGISTRY,
  availableRailsInFamily,
  familyOf,
  resolveRailFilter,
} from './rail.js';

describe('rail families', () => {
  it('places every rail in exactly one family', () => {
    expect(familyOf('bank_fx')).toBe('tradfi');
    expect(familyOf('payment_institution')).toBe('tradfi');
    expect(familyOf('liquidity_provider')).toBe('tradfi');
    expect(familyOf('treasury_product')).toBe('tradfi');
    expect(familyOf('stablecoin_settlement')).toBe('stablecoin');
    expect(familyOf('dex_liquidity')).toBe('defi');
  });

  it('marks DeFi as planned until a priced rail exists', () => {
    expect(RAIL_FAMILY_REGISTRY.tradfi.status).toBe('available');
    expect(RAIL_FAMILY_REGISTRY.stablecoin.status).toBe('available');
    expect(RAIL_FAMILY_REGISTRY.defi.status).toBe('planned');
  });

  it('omits planned rails when expanding a family into a quote filter', () => {
    expect(availableRailsInFamily('tradfi')).toEqual([
      'bank_fx',
      'payment_institution',
      'liquidity_provider',
    ]);
    expect(availableRailsInFamily('stablecoin')).toEqual(['stablecoin_settlement']);
    expect(availableRailsInFamily('defi')).toEqual([]);
    expect(RAIL_REGISTRY.dex_liquidity.status).toBe('planned');
  });

  it('treats an omitted filter as every rail', () => {
    expect(resolveRailFilter({})).toBeNull();
  });

  it('passes an explicit rail list through', () => {
    expect(resolveRailFilter({ rails: ['bank_fx'] })).toEqual(['bank_fx']);
  });

  it('expands a family to its available rails', () => {
    expect(resolveRailFilter({ families: ['stablecoin'] })).toEqual(['stablecoin_settlement']);
  });

  it('intersects rails with families when both are supplied', () => {
    expect(
      resolveRailFilter({
        rails: ['bank_fx', 'stablecoin_settlement'],
        families: ['tradfi'],
      }),
    ).toEqual(['bank_fx']);
  });

  it('returns an empty list when the filters name only planned rails', () => {
    expect(resolveRailFilter({ families: ['defi'] })).toEqual([]);
  });
});
