import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigurationError } from '@meridian/core';
import type { z } from 'zod';
import {
  referenceRatesSchema,
  sandboxPricingSchema,
  type ReferenceRatesData,
  type SandboxPricingData,
} from './schema.js';

export const REFERENCE_RATES_FILE = 'reference-rates.json';
export const SANDBOX_PROVIDERS_FILE = 'sandbox-providers.json';

/**
 * Locates the pricing dataset directory.
 *
 * The dataset is deliberately an external input rather than a compiled-in constant, so it can be
 * replaced (a different sandbox scenario, a regression fixture, a partner's rate card) without a
 * code change. `MERIDIAN_PRICING_DATA_DIR` overrides the bundled default.
 */
export function resolvePricingDataDir(override?: string): string {
  if (override !== undefined && override.trim() !== '') {
    assertDataDir(override, 'MERIDIAN_PRICING_DATA_DIR');
    return override;
  }

  // Walks up from the compiled module so the same code works from `src` under Vitest and from
  // `dist` in a built container.
  let directory = import.meta.dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, 'data');
    if (existsSync(join(candidate, REFERENCE_RATES_FILE))) {
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }

  throw new ConfigurationError(
    `Could not locate the pricing dataset directory containing ${REFERENCE_RATES_FILE}. ` +
      'Set MERIDIAN_PRICING_DATA_DIR to point at it.',
    { searchedFrom: import.meta.dirname },
  );
}

export function loadReferenceRates(dataDir: string): ReferenceRatesData {
  return parseFile(join(dataDir, REFERENCE_RATES_FILE), referenceRatesSchema);
}

export function loadSandboxPricing(dataDir: string): SandboxPricingData {
  return parseFile(join(dataDir, SANDBOX_PROVIDERS_FILE), sandboxPricingSchema);
}

function assertDataDir(directory: string, source: string): void {
  if (!existsSync(join(directory, REFERENCE_RATES_FILE))) {
    throw new ConfigurationError(
      `${source} points at "${directory}", which does not contain ${REFERENCE_RATES_FILE}.`,
      { directory, source },
    );
  }
}

function parseFile<TSchema extends z.ZodType>(path: string, schema: TSchema): z.infer<TSchema> {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigurationError(
      `Could not read the pricing dataset at ${path}.`,
      { path },
      {
        cause: error,
      },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch (error) {
    throw new ConfigurationError(
      `The pricing dataset at ${path} is not valid JSON.`,
      { path },
      {
        cause: error,
      },
    );
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ConfigurationError(`The pricing dataset at ${path} does not match its schema.`, {
      path,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
