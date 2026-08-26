import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import { Money, Rate } from '../money/index.js';
import { canonicalJson } from './canonical-json.js';
import { fingerprint } from './fingerprint.js';

describe('canonicalJson', () => {
  it('sorts object keys so insertion order cannot change the output', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
  });

  it('sorts keys recursively', () => {
    expect(canonicalJson({ outer: { z: 1, a: { y: 2, b: 3 } } })).toBe(
      '{"outer":{"a":{"b":3,"y":2},"z":1}}',
    );
  });

  it('preserves array order, which is semantically meaningful', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('writes bigint as a string so no precision is lost', () => {
    expect(canonicalJson({ minorUnits: 9_007_199_254_740_993n })).toBe(
      '{"minorUnits":"9007199254740993"}',
    );
  });

  it('drops undefined properties instead of emitting them', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('keeps null, which is a meaningful value in the quote contract', () => {
    expect(canonicalJson({ expiresAt: null })).toBe('{"expiresAt":null}');
  });

  it('accepts integers such as settlement seconds', () => {
    expect(canonicalJson({ p50Seconds: 3600 })).toBe('{"p50Seconds":3600}');
  });

  it('rejects a fractional number, which would make the hash depend on float formatting', () => {
    expect(() => canonicalJson({ rate: 1300.55 })).toThrow(ValidationError);
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ value: Number.POSITIVE_INFINITY })).toThrow(ValidationError);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(ValidationError);
  });

  it('rejects a bare undefined', () => {
    expect(() => canonicalJson(undefined)).toThrow(ValidationError);
  });

  it('rejects a function', () => {
    expect(() => canonicalJson({ fn: () => 1 })).toThrow(ValidationError);
  });

  it('canonicalises domain value objects through their transport form', () => {
    expect(canonicalJson({ amount: Money.fromDecimal('USD', '1234.56') })).toBe(
      '{"amount":{"currency":"USD","decimal":"1234.56","exponent":2,"minorUnits":"123456"}}',
    );
    expect(canonicalJson(Rate.of('USD', 'KRW', '1300'))).toBe(
      '{"base":"USD","pair":"USD/KRW","quote":"KRW","value":"1300"}',
    );
  });

  it('escapes strings the same way JSON does', () => {
    expect(canonicalJson({ note: 'a"b\\c\nd' })).toBe('{"note":"a\\"b\\\\c\\nd"}');
  });
});

describe('fingerprint', () => {
  const snapshot = {
    engineVersion: '1.0.0',
    request: { sourceCurrency: 'USD', targetCurrency: 'KRW', amountMinorUnits: '10000000' },
    quotes: [{ providerId: 'a', offeredRate: '1300' }],
  };

  it('is stable across runs for the same input', () => {
    expect(fingerprint(snapshot)).toBe(fingerprint(snapshot));
  });

  it('is independent of key order', () => {
    const reordered = {
      quotes: [{ offeredRate: '1300', providerId: 'a' }],
      request: {
        amountMinorUnits: '10000000',
        targetCurrency: 'KRW',
        sourceCurrency: 'USD',
      },
      engineVersion: '1.0.0',
    };
    expect(fingerprint(reordered)).toBe(fingerprint(snapshot));
  });

  it('changes when the engine version changes', () => {
    expect(fingerprint({ ...snapshot, engineVersion: '1.0.1' })).not.toBe(fingerprint(snapshot));
  });

  it('changes when a quoted rate changes by the smallest increment', () => {
    expect(
      fingerprint({ ...snapshot, quotes: [{ providerId: 'a', offeredRate: '1300.0001' }] }),
    ).not.toBe(fingerprint(snapshot));
  });

  it('is a 64-character hex sha-256 digest', () => {
    expect(fingerprint(snapshot)).toMatch(/^[0-9a-f]{64}$/);
  });
});
