import { describe, expect, it } from 'vitest';
import { CHAIN_REGISTRY, chainMetadata } from './chain.js';
import {
  STABLECOIN_REGISTRY,
  assertStablecoinCorridor,
  chainsOfStablecoin,
  isStablecoinAsset,
  isStablecoinConversionKind,
} from './stablecoin.js';

describe('chain metadata', () => {
  it('lists Ethereum for quotes without connecting to mainnet', () => {
    const ethereum = CHAIN_REGISTRY['eip155:1'];
    expect(ethereum.connected).toBe(false);
    expect(ethereum.rpcUrl).toBeNull();
    expect(ethereum.quoting).toBe('available');
    expect(chainMetadata('eip155:1')?.name).toBe('Ethereum');
  });

  it('reserves future chains as planned, still disconnected', () => {
    expect(CHAIN_REGISTRY['eip155:8453'].quoting).toBe('planned');
    expect(CHAIN_REGISTRY['eip155:8453'].connected).toBe(false);
  });
});

describe('stablecoin registry', () => {
  it('ships USDC and USDT and never claims custody', () => {
    expect(Object.keys(STABLECOIN_REGISTRY).sort()).toEqual(['USDC', 'USDT']);
    expect(isStablecoinAsset('USDC')).toBe(true);
    expect(isStablecoinAsset('USDT')).toBe(true);
    expect(isStablecoinAsset('USD')).toBe(false);
    expect(isStablecoinAsset('ETH')).toBe(false);
    expect(STABLECOIN_REGISTRY.USDC?.custodiedByPlatform).toBe(false);
    expect(STABLECOIN_REGISTRY.USDT?.custodiedByPlatform).toBe(false);
  });

  it('attaches chain metadata to each demo stablecoin', () => {
    const chains = chainsOfStablecoin('USDC');
    expect(chains.some((chain) => chain.id === 'eip155:1' && chain.connected === false)).toBe(true);
  });

  it('accepts the three stablecoin conversion kinds and refuses the rest', () => {
    expect(assertStablecoinCorridor('USD', 'USDC')).toBe('fiat_stablecoin');
    expect(assertStablecoinCorridor('USDC', 'USD')).toBe('stablecoin_fiat');
    expect(assertStablecoinCorridor('USDC', 'USDT')).toBe('stablecoin_stablecoin');
    expect(isStablecoinConversionKind('fiat_fiat')).toBe(false);
    expect(() => assertStablecoinCorridor('USD', 'KRW')).toThrow(/fiat_fiat/);
    expect(() => assertStablecoinCorridor('USDC', 'ETH')).toThrow(/stablecoin_crypto/);
  });
});
