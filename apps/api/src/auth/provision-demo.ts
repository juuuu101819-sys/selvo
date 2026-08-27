import {
  DEMO_AGENT_CREDENTIAL_ID,
  DEMO_AGENT_ID,
  DEMO_AGENT_NAME,
  DEMO_AGENT_SECRET,
  DEMO_MEMBERSHIP_ID,
  DEMO_MERCHANT_CODE,
  DEMO_MERCHANT_ID,
  DEMO_MERCHANT_NAME,
  DEMO_ORGANIZATION_ID,
  DEMO_ORGANIZATION_NAME,
  DEMO_ORGANIZATION_SLUG,
  DEMO_PAYMENT_POLICY_ID,
  DEMO_USER_DISPLAY_NAME,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
  DEMO_USER_PASSWORD,
  DEMO_WALLET_REFERENCE_ID,
  DEFAULT_AGENT_SCOPES,
  OTHER_ORGANIZATION_ID,
  OTHER_ORGANIZATION_NAME,
  OTHER_USER_EMAIL,
  OTHER_USER_ID,
  OTHER_USER_PASSWORD,
  hashPassword,
  hashSecret,
  randomToken,
  type AgentPaymentsRepository,
  type DashboardRepository,
  type IdentityStore,
} from '@meridian/core';
import { API_KEY_PREFIX_LENGTH } from './identity-authenticator.js';

export interface TenantStores {
  readonly identity: IdentityStore;
  readonly dashboard: DashboardRepository;
  readonly agentPayments?: AgentPaymentsRepository;
}

/**
 * Provisions the documented demo tenant and a second isolated tenant.
 *
 * Idempotent. Used by local startup (memory driver) and by authorization tests so both see the
 * same emails and the same isolation property.
 */
export async function provisionDemoTenants(
  stores: TenantStores,
  options: { readonly seedDashboard?: boolean } = {},
): Promise<void> {
  const demoHash = await hashPassword(DEMO_USER_PASSWORD);
  const otherHash = await hashPassword(OTHER_USER_PASSWORD);

  await stores.identity.upsertOrganization({
    id: DEMO_ORGANIZATION_ID,
    name: DEMO_ORGANIZATION_NAME,
    slug: DEMO_ORGANIZATION_SLUG,
    countryCode: 'SG',
  });
  await stores.identity.upsertUser({
    id: DEMO_USER_ID,
    email: DEMO_USER_EMAIL,
    displayName: DEMO_USER_DISPLAY_NAME,
    passwordHash: demoHash,
  });
  await stores.identity.upsertMembership({
    id: DEMO_MEMBERSHIP_ID,
    organizationId: DEMO_ORGANIZATION_ID,
    userId: DEMO_USER_ID,
    role: 'owner',
  });

  await stores.identity.upsertOrganization({
    id: OTHER_ORGANIZATION_ID,
    name: OTHER_ORGANIZATION_NAME,
    slug: 'acme-other',
    countryCode: 'US',
  });
  await stores.identity.upsertUser({
    id: OTHER_USER_ID,
    email: OTHER_USER_EMAIL,
    displayName: 'Acme Ops',
    passwordHash: otherHash,
  });
  await stores.identity.upsertMembership({
    id: 'mbr_acme_owner',
    organizationId: OTHER_ORGANIZATION_ID,
    userId: OTHER_USER_ID,
    role: 'owner',
  });

  const existing = await stores.dashboard.listTransactions(DEMO_ORGANIZATION_ID, { limit: 1 });
  if ((options.seedDashboard ?? true) && existing.length === 0) {
    await seedDashboardActivity(stores.dashboard);
  }

  if (stores.agentPayments !== undefined) {
    await provisionDemoAgent(stores.agentPayments);
  }
}

function isoDaysAgo(days: number): { readonly day: string; readonly at: string } {
  const at = new Date(Date.now() - days * 86_400_000).toISOString();
  return { day: at.slice(0, 10), at };
}

async function seedDashboardActivity(dashboard: DashboardRepository): Promise<void> {
  // Dates sit inside the dashboard's 30-day chart window, which is computed from the clock at
  // query time rather than from a fixture timestamp.
  const dayOffsets = [21, 14, 7, 2] as const;
  const corridors = [
    { amount: '10000000', corridor: ['USD', 'KRW'] as const, ref: 'DEMO-PO-4417' },
    { amount: '25000000', corridor: ['USD', 'EUR'] as const, ref: 'DEMO-PO-4502' },
    { amount: '8000000', corridor: ['USD', 'JPY'] as const, ref: 'DEMO-PO-4588' },
    { amount: '15000000', corridor: ['EUR', 'GBP'] as const, ref: 'DEMO-PO-4610' },
  ] as const;
  const days = corridors.map((entry, index) => ({
    ...isoDaysAgo(dayOffsets[index] ?? 2),
    ...entry,
  }));

  const providers = [
    {
      id: 'sandbox-solstice-settlement',
      name: 'Solstice Settlement',
      rail: 'stablecoin_settlement',
      costBps: '34.00',
      cost: '470467',
      p50: 300,
    },
    {
      id: 'sandbox-aperture-liquidity',
      name: 'Aperture Liquidity',
      rail: 'liquidity_provider',
      costBps: '38.00',
      cost: '526000',
      p50: 1800,
    },
    {
      id: 'sandbox-veridian-payments',
      name: 'Veridian Payments',
      rail: 'payment_institution',
      costBps: '48.00',
      cost: '665000',
      p50: 7200,
    },
    {
      id: 'sandbox-northgate-bank',
      name: 'Northgate Bank',
      rail: 'bank_fx',
      costBps: '72.00',
      cost: '995000',
      p50: 86400,
    },
  ];

  for (const [index, entry] of days.entries()) {
    const requestId = `txr_demo_${index}`;
    const quotedAt = entry.at;
    await dashboard.recordTransaction({
      id: requestId,
      organizationId: DEMO_ORGANIZATION_ID,
      reference: entry.ref,
      sourceCurrency: entry.corridor[0],
      targetCurrency: entry.corridor[1],
      amountMinorUnits: entry.amount,
      status: 'quote_selected',
      selectedQuoteId: `qte_demo_${index}_0`,
      createdAt: quotedAt,
    });
    for (const [rank, provider] of providers.entries()) {
      await dashboard.recordQuote({
        id: `qte_demo_${index}_${rank}`,
        organizationId: DEMO_ORGANIZATION_ID,
        transactionRequestId: requestId,
        providerId: provider.id,
        providerName: provider.name,
        rail: provider.rail,
        status: 'active',
        sourceCurrency: entry.corridor[0],
        targetCurrency: entry.corridor[1],
        amountMinorUnits: entry.amount,
        totalCostMinorUnits: provider.cost,
        totalCostBps: provider.costBps,
        estimatedReceiveMinorUnits: '1',
        benchmarkReceiveMinorUnits: '1',
        settlementP50Seconds: provider.p50,
        quotedAt,
        expiresAt: new Date(Date.parse(quotedAt) + 3_600_000).toISOString(),
        isRecommended: rank === 0,
        rank: rank + 1,
        score: String(100 - rank * 5),
      });
    }
  }

  await dashboard.recordTransaction({
    id: 'txr_other_secret',
    organizationId: OTHER_ORGANIZATION_ID,
    reference: 'OTHER-SHOULD-NOT-LEAK',
    sourceCurrency: 'USD',
    targetCurrency: 'EUR',
    amountMinorUnits: '99999900',
    status: 'quoted',
    selectedQuoteId: null,
    createdAt: '2026-03-20T12:00:00.000Z',
  });
  await dashboard.recordQuote({
    id: 'qte_other_secret',
    organizationId: OTHER_ORGANIZATION_ID,
    transactionRequestId: 'txr_other_secret',
    providerId: 'sandbox-northgate-bank',
    providerName: 'Northgate Bank',
    rail: 'bank_fx',
    status: 'active',
    sourceCurrency: 'USD',
    targetCurrency: 'EUR',
    amountMinorUnits: '99999900',
    totalCostMinorUnits: '888888',
    totalCostBps: '91.00',
    estimatedReceiveMinorUnits: '1',
    benchmarkReceiveMinorUnits: '1',
    settlementP50Seconds: 86_400,
    quotedAt: '2026-03-20T12:00:00.000Z',
    expiresAt: '2026-03-20T13:00:00.000Z',
    isRecommended: true,
    rank: 1,
    score: '10',
  });
}

export function issueDemoApiKeySecret(): { readonly prefix: string; readonly secret: string } {
  const secret = randomToken('mk_');
  return { prefix: secret.slice(0, 16), secret };
}

async function provisionDemoAgent(store: AgentPaymentsRepository): Promise<void> {
  const existing = await store.findAgent(DEMO_AGENT_ID, DEMO_ORGANIZATION_ID);
  if (existing !== null) {
    return;
  }

  const createdAt = '2026-03-01T09:00:00.000Z';
  await store.createAgent({
    id: DEMO_AGENT_ID,
    organizationId: DEMO_ORGANIZATION_ID,
    name: DEMO_AGENT_NAME,
    createdAt,
  });
  await store.createCredential({
    id: DEMO_AGENT_CREDENTIAL_ID,
    agentId: DEMO_AGENT_ID,
    organizationId: DEMO_ORGANIZATION_ID,
    keyPrefix: DEMO_AGENT_SECRET.slice(0, API_KEY_PREFIX_LENGTH),
    secretHash: hashSecret(DEMO_AGENT_SECRET),
    scopes: DEFAULT_AGENT_SCOPES,
    createdAt,
    expiresAt: null,
  });
  await store.createWalletReference({
    id: DEMO_WALLET_REFERENCE_ID,
    organizationId: DEMO_ORGANIZATION_ID,
    agentId: DEMO_AGENT_ID,
    kind: 'external_account',
    label: 'Demo treasury operating account',
    externalRef: 'ext_acct_demo_treasury',
    createdAt,
  });
  await store.createMerchant({
    id: DEMO_MERCHANT_ID,
    organizationId: DEMO_ORGANIZATION_ID,
    name: DEMO_MERCHANT_NAME,
    recipientCode: DEMO_MERCHANT_CODE,
    settlementAsset: 'KRW',
    createdAt,
  });
  await store.createPolicy({
    id: DEMO_PAYMENT_POLICY_ID,
    organizationId: DEMO_ORGANIZATION_ID,
    agentId: DEMO_AGENT_ID,
    maxTransactionAmountMinorUnits: '1000000',
    allowedAssets: ['USD', 'KRW'],
    allowedRecipientCodes: [DEMO_MERCHANT_CODE],
    allowedProviderIds: [],
    maxFeeBps: '100',
    dailySpendingLimitMinorUnits: '2000000',
    dailySpendingAsset: 'USD',
    createdAt,
  });
}

export { hashSecret };
