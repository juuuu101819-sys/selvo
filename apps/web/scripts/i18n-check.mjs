import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = ['en', 'ko', 'ja', 'zh-CN', 'es', 'fr', 'de', 'pt-BR'];
const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '../messages');

function flatten(value, prefix = '') {
  if (typeof value !== 'object' || value === null) {
    return prefix === '' ? [] : [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

const files = readdirSync(messagesDir).filter((name) => name.endsWith('.json'));
const expected = LOCALES.map((locale) => `${locale}.json`).sort();
if (files.sort().join() !== expected.join()) {
  console.error('i18n:check failed: locale files do not match', { files, expected });
  process.exit(1);
}

const en = JSON.parse(readFileSync(join(messagesDir, 'en.json'), 'utf8'));
const enKeys = flatten(en).sort();
let failed = false;

for (const locale of LOCALES) {
  const catalog = JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), 'utf8'));
  const keys = flatten(catalog).sort();
  const missing = enKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !enKeys.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    failed = true;
    console.error(`i18n:check failed: ${locale} keys differ from en`);
    if (missing.length > 0) {
      console.error('  missing', missing);
    }
    if (extra.length > 0) {
      console.error('  extra', extra);
    }
  } else {
    console.log(`i18n:check ${locale}: ${keys.length} keys match en`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('i18n:check passed');
