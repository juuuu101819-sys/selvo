import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import {
  filterRoutingByMandate,
  intersectScopes,
  mandateAllowsAmount,
  mandateAllowsBeneficiary,
  mandateAllowsCorridor,
  parseScopeFromSubject,
} from './scope.js';
import type { MandateScope } from './types.js';
import type { MultiRailRouting, ScoredMultiRailRoute } from '../engine/routing-types.js';
import { Dec } from '../money/index.js';

const USD_KRW: MandateScope = {
  spendCapMinorUnits: '10000000',
  spendCapAsset: 'USD',
  allowedCorridors: [{ source: 'USD', destination: 'KRW' }],
  allowedCurrencies: ['USD', 'KRW'],
  allowedBeneficiaries: ['merchant-x'],
};

describe('parseScopeFromSubject', () => {
  it('parses a fail-closed allowlist and spend cap', () => {
    const scope = parseScopeFromSubject({
      spendCap: { amount: '1000.00', currency: 'usd' },
      allowedCorridors: [{ source: 'usd', destination: 'krw' }],
      allowedCurrencies: ['usd', 'krw'],
      allowedBeneficiaries: ['Merchant-X'],
    });
    expect(scope).toEqual({
      spendCapMinorUnits: '100000',
      spendCapAsset: 'USD',
      allowedCorridors: [{ source: 'USD', destination: 'KRW' }],
      allowedCurrencies: ['USD', 'KRW'],
      allowedBeneficiaries: ['merchant-x'],
    });
  });

  it('rejects empty allowlists instead of treating them as unrestricted', () => {
    expect(() =>
      parseScopeFromSubject({
        spendCap: { amount: '1.00', currency: 'USD' },
        allowedCorridors: [],
        allowedCurrencies: ['USD'],
        allowedBeneficiaries: ['merchant-x'],
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a zero spend cap', () => {
    expect(() =>
      parseScopeFromSubject({
        spendCap: { amount: '0', currency: 'USD' },
        allowedCorridors: [{ source: 'USD', destination: 'KRW' }],
        allowedCurrencies: ['USD', 'KRW'],
        allowedBeneficiaries: ['merchant-x'],
      }),
    ).toThrow(/greater than zero/);
  });
});

describe('intersectScopes', () => {
  it('takes the tighter spend cap and intersecting allowlists', () => {
    const other: MandateScope = {
      spendCapMinorUnits: '5000000',
      spendCapAsset: 'USD',
      allowedCorridors: [
        { source: 'USD', destination: 'KRW' },
        { source: 'USD', destination: 'EUR' },
      ],
      allowedCurrencies: ['USD', 'KRW', 'EUR'],
      allowedBeneficiaries: ['merchant-x', 'merchant-y'],
    };
    expect(intersectScopes([USD_KRW, other])).toEqual({
      spendCapMinorUnits: '5000000',
      spendCapAsset: 'USD',
      allowedCorridors: [{ source: 'USD', destination: 'KRW' }],
      allowedCurrencies: ['USD', 'KRW'],
      allowedBeneficiaries: ['merchant-x'],
    });
  });

  it('fails closed when spend-cap assets differ', () => {
    expect(() =>
      intersectScopes([
        USD_KRW,
        { ...USD_KRW, spendCapAsset: 'EUR' },
      ]),
    ).toThrow(/different spend-cap assets/);
  });
});

describe('mandate allow checks', () => {
  it('allows an in-scope corridor, amount, and beneficiary', () => {
    expect(mandateAllowsCorridor(USD_KRW, 'USD', 'KRW')).toBe(true);
    expect(mandateAllowsAmount(USD_KRW, '10000000', 'USD')).toBe(true);
    expect(mandateAllowsBeneficiary(USD_KRW, 'merchant-x')).toBe(true);
  });

  it('denies out-of-scope corridor, over-cap amount, and unknown beneficiary', () => {
    expect(mandateAllowsCorridor(USD_KRW, 'USD', 'EUR')).toBe(false);
    expect(mandateAllowsAmount(USD_KRW, '10000001', 'USD')).toBe(false);
    expect(mandateAllowsAmount(USD_KRW, '1', 'EUR')).toBe(false);
    expect(mandateAllowsBeneficiary(USD_KRW, 'merchant-y')).toBe(false);
  });

  it('drops out-of-scope ranked routes and re-ranks the remainder', () => {
    const route = (id: string, source: string, target: string): ScoredMultiRailRoute =>
      ({
        routeId: id,
        rank: 1,
        recommended: id === 'keep',
        quote: { sourceAsset: source, targetAsset: target },
        sendAmount: { asset: 'USD', minorUnits: 100n },
        totalCost: { asset: 'USD', minorUnits: 1n },
        deliveredAmount: { asset: target, minorUnits: 1n },
        settlement: { seconds: 60 },
        routeScore: new Dec('80'),
        routeExplanation: 'indicative',
      }) as unknown as ScoredMultiRailRoute;

    const routing = {
      request: { sourceAsset: 'USD', destinationAsset: 'KRW', amountMinorUnits: '100' },
      routes: [route('drop', 'USD', 'EUR'), route('keep', 'USD', 'KRW')],
      recommendedRoute: null,
      routeScore: null,
      estimatedCost: null,
      estimatedReceiveAmount: null,
      estimatedSettlementTime: null,
      routeExplanation: 'ranked',
    } as unknown as MultiRailRouting;

    const filtered = filterRoutingByMandate(routing, USD_KRW);
    expect(filtered.routes.map((row) => row.routeId)).toEqual(['keep']);
    expect(filtered.routes[0]?.rank).toBe(1);
    expect(filtered.routes[0]?.recommended).toBe(true);
  });
});
