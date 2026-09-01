import { canonicalJson } from '../reproducibility/canonical-json.js';
import { omitProof } from './scope.js';
import { signSha256Base64Url, type TestP256KeyPair } from './test-keys.js';
import type { MandateScope } from './types.js';

/**
 * Test-only signed mandate fixtures. Production HTTP never imports this module for signing.
 * Meridian verifies public proofs; it does not generate customer keys.
 */

export interface TestMandateScopeBody {
  readonly spendCap: { readonly amount: string; readonly currency: string };
  readonly allowedCorridors: readonly { readonly source: string; readonly destination: string }[];
  readonly allowedCurrencies: readonly string[];
  readonly allowedBeneficiaries: readonly string[];
}

export const USD_KRW_SCOPE: TestMandateScopeBody = {
  spendCap: { amount: '100000.00', currency: 'USD' },
  allowedCorridors: [{ source: 'USD', destination: 'KRW' }],
  allowedCurrencies: ['USD', 'KRW'],
  allowedBeneficiaries: ['merchant-x'],
};

export const USD_EUR_SCOPE: TestMandateScopeBody = {
  spendCap: { amount: '100000.00', currency: 'USD' },
  allowedCorridors: [{ source: 'USD', destination: 'EUR' }],
  allowedCurrencies: ['USD', 'EUR'],
  allowedBeneficiaries: ['merchant-x'],
};

export function signedAp2VerifyBody(
  keys: TestP256KeyPair,
  options: {
    readonly kind?: 'intent' | 'cart';
    readonly issuer?: string;
    readonly validUntil?: string;
    readonly scope?: TestMandateScopeBody;
    readonly tamperSignature?: boolean;
  } = {},
): { readonly format: 'ap2'; readonly credential: Record<string, unknown> } {
  const unsigned: Record<string, unknown> = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', options.kind === 'cart' ? 'CartMandate' : 'IntentMandate'],
    issuer: options.issuer ?? 'did:example:treasury',
    validUntil: options.validUntil ?? '2026-12-01T00:00:00.000Z',
    credentialSubject: options.scope ?? USD_KRW_SCOPE,
  };
  let proofValue = signSha256Base64Url(keys.privateKey, canonicalJson(unsigned));
  if (options.tamperSignature === true) {
    proofValue = `A${proofValue.slice(1)}`;
  }
  return {
    format: 'ap2',
    credential: {
      ...unsigned,
      proof: {
        type: 'EcdsaSecp256r1Signature2019',
        proofValue,
        verificationMethod: keys.publicJwk,
      },
    },
  };
}

export function signedMppVerifyBody(
  keys: TestP256KeyPair,
  options: {
    readonly expiresAt?: string;
    readonly sessionId?: string;
    readonly scope?: TestMandateScopeBody;
    readonly tamperSignature?: boolean;
  } = {},
): { readonly format: 'mpp'; readonly session: Record<string, unknown>; readonly proof: Record<string, unknown> } {
  const scope = options.scope ?? USD_KRW_SCOPE;
  const session: Record<string, unknown> = {
    id: options.sessionId ?? 'sess_test_mpp',
    expiresAt: options.expiresAt ?? '2026-12-01T00:00:00.000Z',
    spendCap: scope.spendCap,
    allowedCorridors: scope.allowedCorridors,
    allowedCurrencies: scope.allowedCurrencies,
    allowedBeneficiaries: scope.allowedBeneficiaries,
  };
  let signature = signSha256Base64Url(keys.privateKey, canonicalJson(omitProof(session)));
  if (options.tamperSignature === true) {
    signature = `A${signature.slice(1)}`;
  }
  return {
    format: 'mpp',
    session,
    proof: {
      publicKeyJwk: keys.publicJwk,
      signature,
    },
  };
}

export function signedX402Authorization(
  keys: TestP256KeyPair,
  challenge: {
    readonly id: string;
    readonly nonce: string;
    readonly organizationId: string;
    readonly agentId: string;
    readonly scope: MandateScope;
  },
  tamperSignature = false,
): {
  readonly format: 'x402';
  readonly challengeId: string;
  readonly authorization: { readonly publicKeyJwk: TestP256KeyPair['publicJwk']; readonly signature: string };
} {
  const message = canonicalJson({
    challengeId: challenge.id,
    nonce: challenge.nonce,
    organizationId: challenge.organizationId,
    agentId: challenge.agentId,
    scope: challenge.scope,
  });
  let signature = signSha256Base64Url(keys.privateKey, message);
  if (tamperSignature) {
    signature = `A${signature.slice(1)}`;
  }
  return {
    format: 'x402',
    challengeId: challenge.id,
    authorization: {
      publicKeyJwk: keys.publicJwk,
      signature,
    },
  };
}
