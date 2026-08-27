import { describe, expect, it } from 'vitest';
import { PLATFORM_CAPABILITIES } from './capabilities.js';

describe('PLATFORM_CAPABILITIES', () => {
  it('enables route comparison and nothing that would move money or hold assets', () => {
    expect(PLATFORM_CAPABILITIES.compareRoutes).toBe(true);
    expect(PLATFORM_CAPABILITIES.executeTransactions).toBe(false);
    expect(PLATFORM_CAPABILITIES.delegateExecution).toBe(false);
    expect(PLATFORM_CAPABILITIES.custodyFunds).toBe(false);
    expect(PLATFORM_CAPABILITIES.holdCryptoAssets).toBe(false);
    expect(PLATFORM_CAPABILITIES.holdPrivateKeys).toBe(false);
    expect(PLATFORM_CAPABILITIES.controlCustomerWallets).toBe(false);
    expect(PLATFORM_CAPABILITIES.operateAsPrincipal).toBe(false);
    expect(PLATFORM_CAPABILITIES.issueStablecoins).toBe(false);
    expect(PLATFORM_CAPABILITIES.agentPayments).toBe(false);
    expect(PLATFORM_CAPABILITIES.defiQuotes).toBe(true);
    expect(PLATFORM_CAPABILITIES.defiExecution).toBe(false);
  });
});
