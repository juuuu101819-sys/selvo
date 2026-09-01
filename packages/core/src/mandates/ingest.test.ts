import { describe, expect, it } from 'vitest';
import { MandateRejectedError } from '../errors/index.js';
import { parseAp2Mandate } from './ap2.js';
import { parseMppMandate } from './mpp.js';
import { parseX402Authorization, parseX402ScopeRequest } from './x402.js';
import { readFormat, parseSignedMandate } from './ingest.js';
import { isP256PublicJwk } from './ecdsa.js';
import { generateTestP256KeyPair } from './test-keys.js';
import { signedAp2VerifyBody, signedMppVerifyBody, signedX402Authorization, USD_KRW_SCOPE } from './test-payloads.js';

const NOW = '2026-03-01T09:00:00.000Z';

describe('mandate format detection', () => {
  it('accepts ap2, x402, and mpp', () => {
    expect(readFormat({ format: 'ap2', credential: {} })).toBe('ap2');
    expect(readFormat({ format: 'x402' })).toBe('x402');
    expect(readFormat({ format: 'mpp' })).toBe('mpp');
  });

  it('rejects an unknown format fail-closed', () => {
    try {
      readFormat({ format: 'jose' });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(MandateRejectedError);
      expect((error as MandateRejectedError).details['reason']).toBe('unsupported_format');
    }
  });

  it('does not parse x402 as a one-shot signed document', () => {
    try {
      parseSignedMandate({ format: 'x402', scope: USD_KRW_SCOPE }, NOW);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(MandateRejectedError);
      expect((error as MandateRejectedError).details['reason']).toBe('challenge_required');
    }
  });
});

describe('AP2 Verifiable Credentials', () => {
  it('verifies an Intent Mandate signed with ECDSA P-256 + SHA-256', () => {
    const keys = generateTestP256KeyPair();
    const parsed = parseAp2Mandate(signedAp2VerifyBody(keys, { kind: 'intent' }), NOW);
    expect(parsed.format).toBe('ap2_intent');
    expect(parsed.scope.spendCapAsset).toBe('USD');
    expect(parsed.scope.allowedCorridors).toEqual([{ source: 'USD', destination: 'KRW' }]);
  });

  it('verifies a Cart Mandate', () => {
    const keys = generateTestP256KeyPair();
    const parsed = parseAp2Mandate(signedAp2VerifyBody(keys, { kind: 'cart' }), NOW);
    expect(parsed.format).toBe('ap2_cart');
  });

  it('rejects an expired credential', () => {
    const keys = generateTestP256KeyPair();
    try {
      parseAp2Mandate(signedAp2VerifyBody(keys, { validUntil: '2026-02-01T00:00:00.000Z' }), NOW);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(MandateRejectedError);
      expect((error as MandateRejectedError).details['reason']).toBe('expired');
    }
  });

  it('rejects a forged signature', () => {
    const keys = generateTestP256KeyPair();
    try {
      parseAp2Mandate(signedAp2VerifyBody(keys, { tamperSignature: true }), NOW);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(MandateRejectedError);
      expect((error as MandateRejectedError).details['reason']).toBe('signature_invalid');
    }
  });

  it('rejects a public JWK that includes private `d`', () => {
    expect(
      isP256PublicJwk({
        kty: 'EC',
        crv: 'P-256',
        x: 'AA',
        y: 'AA',
        d: 'secret',
      }),
    ).toBe(false);
  });
});

describe('MPP session mandates', () => {
  it('verifies a session spend-cap lock without consuming it', () => {
    const keys = generateTestP256KeyPair();
    const parsed = parseMppMandate(signedMppVerifyBody(keys), NOW);
    expect(parsed.format).toBe('mpp');
    expect(parsed.issuer).toBe('mpp:sess_test_mpp');
    expect(parsed.scope.spendCapMinorUnits).toBe('10000000');
  });

  it('rejects an expired session', () => {
    const keys = generateTestP256KeyPair();
    try {
      parseMppMandate(signedMppVerifyBody(keys, { expiresAt: '2026-02-01T00:00:00.000Z' }), NOW);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(MandateRejectedError);
      expect((error as MandateRejectedError).details['reason']).toBe('expired');
    }
  });
});

describe('x402 challenge authorization', () => {
  it('parses the requested scope from the first call', () => {
    const scope = parseX402ScopeRequest({ format: 'x402', scope: USD_KRW_SCOPE });
    expect(scope.spendCapAsset).toBe('USD');
    expect(scope.allowedBeneficiaries).toEqual(['merchant-x']);
  });

  it('verifies a signature over the challenge binding', () => {
    const keys = generateTestP256KeyPair();
    const challenge = {
      id: 'x402_1',
      organizationId: 'org_demo_meridian',
      agentId: 'agt_demo_treasury',
      nonce: 'n1',
      scope: parseX402ScopeRequest({ scope: USD_KRW_SCOPE }),
      expiresAt: '2026-03-01T09:05:00.000Z',
      createdAt: NOW,
    };
    const parsed = parseX402Authorization(signedX402Authorization(keys, challenge), challenge, NOW);
    expect(parsed.format).toBe('x402');
    expect(parsed.issuer).toBe('x402:x402_1');
  });

  it('rejects a forged x402 authorization', () => {
    const keys = generateTestP256KeyPair();
    const challenge = {
      id: 'x402_1',
      organizationId: 'org_demo_meridian',
      agentId: 'agt_demo_treasury',
      nonce: 'n1',
      scope: parseX402ScopeRequest({ scope: USD_KRW_SCOPE }),
      expiresAt: '2026-03-01T09:05:00.000Z',
      createdAt: NOW,
    };
    try {
      parseX402Authorization(signedX402Authorization(keys, challenge, true), challenge, NOW);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(MandateRejectedError);
      expect((error as MandateRejectedError).details['reason']).toBe('signature_invalid');
    }
  });
});
