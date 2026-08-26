import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigurationError } from '@meridian/core';

export const MIGRATION_DIRECTORY = join('prisma', 'migrations');

/**
 * Reads every migration in order, concatenated.
 *
 * Used by the test that asserts the invariants Prisma cannot express — the CHECK constraints, the
 * partial unique index and the append-only trigger — are still present. Those statements are
 * hand-added to generated files, which is exactly the kind of edit a future `migrate diff` could
 * quietly drop.
 *
 * Discovering the directories rather than naming one keeps the check working when a migration is
 * added or the timestamped folder is renamed, and means the assertions apply to the schema as a
 * whole rather than to whichever file happened to introduce a constraint.
 */
export function readMigrations(): string {
  const root = locateMigrationRoot();
  const directories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (directories.length === 0) {
    throw new ConfigurationError(`No migrations found in ${root}.`, { root });
  }

  return directories
    .map((directory) => {
      const file = join(root, directory, 'migration.sql');
      return existsSync(file) ? readFileSync(file, 'utf8') : '';
    })
    .join('\n');
}

export function locateMigrationRoot(): string {
  let directory = import.meta.dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(directory, MIGRATION_DIRECTORY);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  throw new ConfigurationError(`Could not locate ${MIGRATION_DIRECTORY}.`, {
    searchedFrom: import.meta.dirname,
  });
}
