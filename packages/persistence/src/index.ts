import { ConfigurationError, type PersistenceDriver } from '@meridian/core';
import { InMemoryPersistenceDriver } from './memory/memory-driver.js';
import { PrismaPersistenceDriver } from './postgres/prisma-driver.js';

export const PERSISTENCE_DRIVERS = ['memory', 'postgres'] as const;
export type PersistenceDriverKind = (typeof PERSISTENCE_DRIVERS)[number];

export interface PersistenceOptions {
  readonly driver: PersistenceDriverKind;
  readonly connectionString?: string | undefined;
  readonly maxConnections?: number | undefined;
  readonly ssl?: boolean | undefined;
}

/**
 * Builds the configured driver.
 *
 * The rest of the application receives a `PersistenceDriver` and never learns which one it got, so
 * swapping the store is a configuration change rather than a code change.
 */
export function createPersistenceDriver(options: PersistenceOptions): PersistenceDriver {
  switch (options.driver) {
    case 'memory':
      return new InMemoryPersistenceDriver();
    case 'postgres': {
      if (options.connectionString === undefined || options.connectionString.trim() === '') {
        throw new ConfigurationError(
          'DATABASE_URL must be set when DATABASE_DRIVER is "postgres".',
        );
      }
      return new PrismaPersistenceDriver({
        connectionString: options.connectionString,
        ...(options.maxConnections === undefined ? {} : { maxConnections: options.maxConnections }),
        ...(options.ssl === undefined ? {} : { ssl: options.ssl }),
      });
    }
  }
}

export { InMemoryAgentPaymentsRepository } from './memory/memory-agent-payments.js';
export { InMemoryExecutionIntentRepository } from './memory/memory-execution-intents.js';
export { InMemoryDashboardRepository } from './memory/memory-dashboard.js';
export { InMemoryIdentityStore } from './memory/memory-identity.js';
export { InMemoryOnboardingStore } from './memory/memory-onboarding.js';
export { InMemoryBillingStore } from './memory/memory-billing.js';
export {
  InMemoryAuditLogRepository,
  InMemoryComparisonRepository,
  InMemoryPersistenceDriver,
} from './memory/memory-driver.js';
export { PrismaAgentPaymentsRepository } from './postgres/prisma-agent-payments.js';
export { PrismaDashboardRepository } from './postgres/prisma-dashboard.js';
export { PrismaExecutionIntentRepository } from './postgres/prisma-execution-intents.js';
export { PrismaIdentityStore } from './postgres/prisma-identity.js';
export { PrismaOnboardingStore } from './postgres/prisma-onboarding.js';
export { PrismaBillingStore } from './postgres/prisma-billing.js';
export { PrismaPlatformPricingResolver } from './postgres/prisma-pricing-resolver.js';
export {
  PrismaPersistenceDriver,
  toAuditEvent,
  toStoredComparison,
  type AuditEventRow,
  type ComparisonRow,
  type PrismaDriverOptions,
} from './postgres/prisma-driver.js';
export { InMemoryRateLimitStore } from './rate-limit/memory-store.js';
export { PrismaRateLimitStore } from './rate-limit/prisma-store.js';
export { consumeFixedWindow } from './rate-limit/fixed-window.js';
export { readMigrations, locateMigrationRoot, MIGRATION_DIRECTORY } from './migrations.js';
