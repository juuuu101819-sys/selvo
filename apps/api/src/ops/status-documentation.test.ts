import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_FINANCIAL_STATUS_DOCS, RETIRED_PAYMENT_INTENT_STATUSES } from '@meridian/core';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const apiDocs = readFileSync(join(repoRoot, 'docs/API.md'), 'utf8');

describe('API financial status documentation', () => {
  it('documents every API-reachable financial status with realized revenue: no', () => {
    expect(apiDocs).toContain('## Financial status values');
    for (const entry of API_FINANCIAL_STATUS_DOCS) {
      const row = `| ${entry.family} | \`${entry.value}\` | ${entry.meaning} | no |`;
      expect(apiDocs, `missing API.md row for ${entry.family}:${entry.value}`).toContain(row);
    }
  });

  it('does not document retired settlement-like payment-intent names as live statuses', () => {
    for (const retired of RETIRED_PAYMENT_INTENT_STATUSES) {
      expect(apiDocs).not.toContain(`| payment_intent | \`${retired}\` |`);
    }
  });
});
