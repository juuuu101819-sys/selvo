import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Invariant ③: the platform does not hold customer or agent fund balances.
 *
 * This is a schema-introspection guardrail. A new table or field with custody/balance semantics
 * must be allowlisted here after a compliance review — the test fails loudly otherwise.
 */
const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../../prisma/schema.prisma');

const ALLOWLISTED_MODELS = new Set([
  'AgentWalletReference',
  'MonetizationEvent',
  'Invoice',
  'InvoiceLine',
  'PaymentPolicy',
  'PaymentIntent',
  'Quote',
  'Fee',
  'CustomerPricing',
]);

const FORBIDDEN_MODEL = /(Customer|Agent|User|Org|Wallet|Account|Fund|Asset|Crypto)?(Balance|CustodyLedger|FundHolding|HeldAsset|WalletLedger)s?$/i;
const FORBIDDEN_FIELD =
  /^(customer|agent|user|org|wallet|account|fund|available|held|crypto|userFund|platformHeld).*Balance$|^(balance|heldFunds|customerFunds|availableFunds)$/i;
const FORBIDDEN_MAP = /(customer|agent|user|wallet|account|fund)_?balances?$|custody_ledgers?$/i;

describe('invariant ③ — no customer fund-balance model', () => {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const stripped = schema.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('has no customer or agent fund-balance table', () => {
    const models = [...stripped.matchAll(/model\s+(\w+)/g)].map((match) => match[1] ?? '');
    expect(models.length).toBeGreaterThan(10);
    for (const name of models) {
      if (ALLOWLISTED_MODELS.has(name)) {
        continue;
      }
      expect(name, `model ${name} looks like a custody/balance table`).not.toMatch(FORBIDDEN_MODEL);
    }
  });

  it('maps no table whose name is a customer/agent balance ledger', () => {
    const maps = [...stripped.matchAll(/@@map\("([^"]+)"\)/g)].map((match) => match[1] ?? '');
    for (const table of maps) {
      expect(table, `@@map("${table}") looks like a balance ledger`).not.toMatch(FORBIDDEN_MAP);
    }
  });

  it('has no customer-balance field on domain models', () => {
    const blocks = stripped.split(/model\s+/).slice(1);
    for (const block of blocks) {
      const name = block.split(/\s/)[0] ?? '';
      const body = block.slice(name.length);
      const fields = [...body.matchAll(/^\s+(\w+)\s+/gm)].map((match) => match[1] ?? '');
      for (const field of fields) {
        if (field === 'controlledByPlatform' || field === 'dailySpendingLimitMinorUnits') {
          continue;
        }
        expect(field, `${name}.${field} looks like a held balance`).not.toMatch(FORBIDDEN_FIELD);
      }
    }
  });

  it('keeps AgentWalletReference non-custodial by construction', () => {
    expect(schema).toContain('model AgentWalletReference');
    expect(schema).toContain('controlledByPlatform');
    expect(schema).toMatch(/controlledByPlatform\s+Boolean\s+@default\(false\)/);
  });
});
