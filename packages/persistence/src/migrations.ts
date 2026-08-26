import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigurationError } from '@meridian/core';

export const MIGRATION_DIRECTORY = join('prisma', 'migrations');

const INITIAL_MIGRATION = join(MIGRATION_DIRECTORY, '20260826000000_init', 'migration.sql');

/**
 * Reads the initial migration from disk.
 *
 * Used by the test that asserts the invariants Prisma cannot express — the CHECK constraints and
 * the append-only trigger — are still present. Those statements are hand-added to a generated file,
 * which is exactly the kind of edit a future `migrate diff` could quietly drop.
 */
export function readInitialMigration(): string {
  let directory = import.meta.dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(directory, INITIAL_MIGRATION);
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  throw new ConfigurationError(`Could not locate ${INITIAL_MIGRATION}.`, {
    searchedFrom: import.meta.dirname,
  });
}
