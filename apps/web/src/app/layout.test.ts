import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(fileURLToPath(import.meta.url));
const localeRoot = join(root, '[locale]');
const enCatalog = readFileSync(join(root, '../../messages/en.json'), 'utf8');
const localeLayout = readFileSync(join(localeRoot, 'layout.tsx'), 'utf8');
const landing = readFileSync(join(localeRoot, 'page.tsx'), 'utf8');
const bestRoute = readFileSync(join(root, '../components/best-route.tsx'), 'utf8');
const routeCard = readFileSync(join(root, '../components/route-card.tsx'), 'utf8');
const footer = readFileSync(join(root, '../components/site-footer.tsx'), 'utf8');
const terms = readFileSync(join(localeRoot, 'terms/page.tsx'), 'utf8');
const privacy = readFileSync(join(localeRoot, 'privacy/page.tsx'), 'utf8');
const legalDocument = readFileSync(join(root, '../components/legal-document.tsx'), 'utf8');

describe('marketing copy (PHASE 39 positioning)', () => {
  it('does not claim Meridian is a bank, exchange, licensed broker, payment institution, or settlement provider', () => {
    const claimPatterns = [
      /Meridian is (a |an )?(licensed )?(bank|exchange|broker|payment institution|settlement provider)/i,
      /operate as (a |an )?(licensed )?(bank|exchange|broker)/i,
    ];
    for (const pattern of claimPatterns) {
      expect(enCatalog).not.toMatch(pattern);
      expect(landing).not.toMatch(pattern);
      expect(terms).not.toMatch(pattern);
    }
  });

  it('states that Meridian does not execute or settle', () => {
    expect(enCatalog).toMatch(/does not execute, settle, or custody funds/i);
    expect(enCatalog).toMatch(/does not execute or delegate settlement/i);
  });

  it('names businesses and AI agents as the audience', () => {
    expect(enCatalog).toMatch(/businesses and AI agents/i);
  });

  it('does not claim a licensed partner is already connected', () => {
    expect(enCatalog).not.toMatch(/delegated to licensed partners/i);
    expect(enCatalog).toMatch(/until a licensed partner is connected/i);
    expect(bestRoute).not.toMatch(/through licensed partners/i);
    expect(routeCard).not.toMatch(/through licensed on-ramp/i);
  });
});

describe('legal disclosure pages', () => {
  it('links terms and privacy from the shared footer', () => {
    expect(footer).toMatch(/href="\/terms"/);
    expect(footer).toMatch(/href="\/privacy"/);
    expect(footer).toMatch(/t\('terms'\)/);
    expect(footer).toMatch(/t\('privacy'\)/);
    expect(enCatalog).toMatch(/"terms": "Terms of use"/);
    expect(enCatalog).toMatch(/"privacy": "Privacy"/);
  });

  it('marks terms and privacy as draft and not in force', () => {
    expect(legalDocument).toMatch(/not a binding contract/i);
    expect(legalDocument).toMatch(/Draft · not in force/i);
    expect(terms).toMatch(/Counsel has not issued an in-force version/i);
    expect(privacy).toMatch(/not an in-force privacy policy/i);
  });

  it('does not advertise a public take-rate on transaction volume', () => {
    expect(terms).toMatch(/does not charge a percentage of customer transaction volume/i);
    expect(terms).toMatch(/usage or subscription term/i);
  });

  it('restates non-custodial boundaries on both pages', () => {
    expect(terms).toMatch(/does not take custody of money/i);
    expect(privacy).toMatch(/does not hold customer funds, private keys, or wallets/i);
  });
});

describe('open graph and icons', () => {
  it('declares Open Graph and Twitter metadata on the locale layout', () => {
    expect(localeLayout).toMatch(/openGraph:/);
    expect(localeLayout).toMatch(/twitter:/);
    expect(localeLayout).toMatch(/summary_large_image/);
    expect(localeLayout).toMatch(/metadataBase:/);
    expect(localeLayout).toMatch(/alternates:/);
    expect(localeLayout).toMatch(/html lang=\{locale\}/);
  });
});
