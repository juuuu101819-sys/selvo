import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOCALES } from './locales';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages');

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return prefix === '' ? [] : [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('message catalogs', () => {
  const en = JSON.parse(readFileSync(join(messagesDir, 'en.json'), 'utf8')) as unknown;
  const enKeys = flatten(en).sort();

  it('ships a file for every supported locale', () => {
    const files = readdirSync(messagesDir).filter((name) => name.endsWith('.json'));
    expect(files.sort()).toEqual([...LOCALES].map((locale) => `${locale}.json`).sort());
  });

  it.each([...LOCALES])('%s has the same keys as en', (locale) => {
    const catalog = JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), 'utf8')) as unknown;
    expect(flatten(catalog).sort()).toEqual(enKeys);
  });

  it.each([...LOCALES].filter((locale) => locale !== 'en'))(
    '%s currently copies English values as the fallback',
    (locale) => {
      const catalog = JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), 'utf8')) as unknown;
      expect(catalog).toEqual(en);
    },
  );
});
