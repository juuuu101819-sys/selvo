import { CURRENCY_REGISTRY, PersistenceError, type CurrencyCode } from '@meridian/core';
import { Prisma, type PrismaClient } from '@prisma/client';

const DASHBOARD_CURRENCIES = ['USD', 'KRW', 'EUR', 'JPY', 'GBP'] as const satisfies readonly CurrencyCode[];

const DASHBOARD_PROVIDERS = [
  {
    id: 'sandbox-solstice-settlement',
    slug: 'sandbox-solstice-settlement',
    name: 'Solstice Settlement',
    rail: 'stablecoin_settlement' as const,
  },
  {
    id: 'sandbox-aperture-liquidity',
    slug: 'sandbox-aperture-liquidity',
    name: 'Aperture Liquidity',
    rail: 'liquidity_provider' as const,
  },
  {
    id: 'sandbox-veridian-payments',
    slug: 'sandbox-veridian-payments',
    name: 'Veridian Payments',
    rail: 'payment_institution' as const,
  },
  {
    id: 'sandbox-northgate-bank',
    slug: 'sandbox-northgate-bank',
    name: 'Northgate Bank',
    rail: 'bank_fx' as const,
  },
] as const;

const NUMERIC_CODES: Record<(typeof DASHBOARD_CURRENCIES)[number], string> = {
  USD: '840',
  KRW: '410',
  EUR: '978',
  JPY: '392',
  GBP: '826',
};

/**
 * Catalog rows the in-process demo dashboard seed needs on Postgres (FK targets for quotes).
 *
 * Memory dashboard stores DTOs without FKs. PA-L06 e2e against a migrated-from-scratch database
 * still uses `SEED_DEMO_TENANTS`; this upsert is that catalog, not leftover state from a prior run.
 */
export async function ensureSandboxDashboardCatalog(client: PrismaClient): Promise<void> {
  try {
    for (const code of DASHBOARD_CURRENCIES) {
      const meta = CURRENCY_REGISTRY[code];
      await client.currency.upsert({
        where: { code },
        create: {
          code,
          numericCode: NUMERIC_CODES[code],
          name: meta.name,
          exponent: meta.exponent,
          kind: 'fiat',
          isActive: true,
        },
        update: { exponent: meta.exponent, isActive: true },
      });
    }

    for (const provider of DASHBOARD_PROVIDERS) {
      await client.provider.upsert({
        where: { id: provider.id },
        create: {
          id: provider.id,
          slug: provider.slug,
          name: provider.name,
          rail: provider.rail,
          licensing: 'unlicensed_sandbox',
          modes: ['sandbox'],
          jurisdictions: ['*'],
          description: `${provider.name} sandbox catalog row for demo dashboard quotes. Unlicensed.`,
          adapterId: provider.id,
          pricingVersion: 'dashboard-e2e',
          reliabilityScore: new Prisma.Decimal('0.9900'),
          quoteTtlSeconds: 900,
          metadata: { demoOnly: true },
        },
        update: { name: provider.name, rail: provider.rail },
      });
    }
  } catch (error) {
    throw new PersistenceError('Failed to ensure the sandbox dashboard catalog.', {}, { cause: error });
  }
}
