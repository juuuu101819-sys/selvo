import { describe, expect, it } from 'vitest';
import { CHAIN_REGISTRY, chainMetadata } from './chain.js';
import {
  DEFI_POOL_REGISTRY,
  DEFI_VENUE_KINDS,
  chainsForDeFiVenue,
  poolOf,
} from './defi-liquidity.js';

describe('chain metadata for future DeFi venues', () => {
  it('lists Ethereum for quotes without connecting', () => {
    expect(CHAIN_REGISTRY['eip155:1']?.connected).toBe(false);
    expect(CHAIN_REGISTRY['eip155:1']?.rpcUrl).toBeNull();
  });

  it('reserves Base, Arbitrum and Solana as planned, still disconnected', () => {
    expect(CHAIN_REGISTRY['eip155:8453']?.quoting).toBe('planned');
    expect(CHAIN_REGISTRY['eip155:42161']?.name).toBe('Arbitrum');
    expect(CHAIN_REGISTRY['eip155:42161']?.connected).toBe(false);
    expect(CHAIN_REGISTRY['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']?.namespace).toBe('solana');
    expect(CHAIN_REGISTRY['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']?.quoting).toBe('planned');
    expect(CHAIN_REGISTRY['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']?.connected).toBe(false);
    expect(chainMetadata('eip155:42161')?.rpcUrl).toBeNull();
  });
});

describe('DeFi pool registry', () => {
  it('ships USDC/USDT, ETH/USDC and ETH/USDT without claiming custody', () => {
    expect(DEFI_POOL_REGISTRY.map((pool) => pool.id).sort()).toEqual([
      'ETH/USDC',
      'ETH/USDT',
      'USDC/USDT',
    ]);
    expect(DEFI_POOL_REGISTRY.every((pool) => pool.custodiedByPlatform === false)).toBe(true);
    expect(poolOf('USDC', 'USDT')?.id).toBe('USDC/USDT');
    expect(poolOf('USDT', 'USDC')?.id).toBe('USDC/USDT');
    expect(poolOf('USD', 'KRW')).toBeNull();
  });

  it('names DEX, AMM and aggregator as data, and lists future chains without connecting', () => {
    expect([...DEFI_VENUE_KINDS]).toEqual(['dex', 'amm', 'aggregator']);
    const chains = chainsForDeFiVenue();
    expect(chains.every((chain) => chain.connected === false && chain.rpcUrl === null)).toBe(true);
    expect(chains.some((chain) => chain.name === 'Solana')).toBe(true);
  });
});
