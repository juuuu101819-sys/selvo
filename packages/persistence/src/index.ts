import { ConfigurationError, type PersistenceDriver } from '@meridian/core';
import { InMemoryPersistenceDriver } from './memory/memory-driver.js';
import { PostgresPersistenceDriver } from './postgres/postgres-driver.js';

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
 * The rest of the application receives a `PersistenceDriver` and never learns which one it got,
 * so swapping the store is a configuration change rather than a code change.
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
      return new PostgresPersistenceDriver({
        connectionString: options.connectionString,
        ...(options.maxConnections === undefined ? {} : { maxConnections: options.maxConnections }),
        ...(options.ssl === undefined ? {} : { ssl: options.ssl }),
      });
    }
  }
}

export {
  InMemoryAuditLogRepository,
  InMemoryComparisonRepository,
  InMemoryPersistenceDriver,
} from './memory/memory-driver.js';
export {
  PostgresPersistenceDriver,
  readInitialMigration,
  type PostgresDriverOptions,
} from './postgres/postgres-driver.js';
