import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BILLABLE_ACTIONS,
  BILLABLE_EVENT_CLASSES,
  METERED_ENDPOINTS,
  PRICING_SHAPES,
  REVENUE_LIFECYCLE_STATES,
  REVENUE_ORIGIN_ENVS,
  billableClassForAction,
  flagNameFor,
} from '@meridian/core';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const doc = readFileSync(join(repoRoot, 'docs/MONETIZATION.md'), 'utf8');

/**
 * §18.6 requires the action-to-charge-class mapping to be *documented*, not merely implemented.
 * These assertions keep the document from drifting: adding a billable action or a pricing shape
 * without saying what it costs fails here.
 */
describe('docs/MONETIZATION.md documents the billing surface it is the reference for', () => {
  it('names every billable action and the one class it is charged under', () => {
    for (const action of BILLABLE_ACTIONS) {
      expect(doc, `undocumented action ${action}`).toContain(`\`${action}\``);
      const row = doc
        .split('\n')
        .find((line) => line.includes(`\`${action}\``) && line.startsWith('|'));
      expect(row, `no taxonomy row for ${action}`).toBeDefined();
      expect(row, `${action} row does not state its charge class`).toContain(
        billableClassForAction(action),
      );
    }
  });

  it('names every charge class', () => {
    for (const eventClass of BILLABLE_EVENT_CLASSES) {
      expect(doc).toContain(`\`${eventClass}\``);
    }
  });

  it('names every metered endpoint counter', () => {
    for (const endpoint of METERED_ENDPOINTS) {
      expect(doc, `undocumented usage counter ${endpoint}`).toContain(endpoint);
    }
  });

  it('names every pricing shape with its flag', () => {
    for (const shape of PRICING_SHAPES) {
      expect(doc, `undocumented pricing flag for ${shape}`).toContain(flagNameFor(shape));
    }
  });

  it('names every lifecycle state and origin environment', () => {
    for (const state of REVENUE_LIFECYCLE_STATES) {
      expect(doc).toContain(state);
    }
    for (const origin of REVENUE_ORIGIN_ENVS) {
      expect(doc).toContain(origin);
    }
  });

  it('states that the placeholder prices are not commercially validated', () => {
    // The tier numbers are shaped correctly and decided by nobody. A reader who takes them for a
    // price list is the failure this sentence exists to prevent.
    // Whitespace-tolerant: the document is hard-wrapped, so the phrase can straddle a line.
    expect(doc).toMatch(/placeholders/i);
    expect(doc).toMatch(/validated\s+commercially/i);
  });

  it('states the launch default for collection', () => {
    expect(doc).toContain('BILLING_LIVE_ENABLED');
    expect(doc).toContain('RECORD_ONLY');
    expect(doc).toMatch(/no processor is ever\s+contacted/i);
  });
});
