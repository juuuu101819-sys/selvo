import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(join(root, 'layout.tsx'), 'utf8');
const landing = readFileSync(join(root, 'page.tsx'), 'utf8');
const bestRoute = readFileSync(join(root, '../components/best-route.tsx'), 'utf8');
const routeCard = readFileSync(join(root, '../components/route-card.tsx'), 'utf8');

describe('marketing copy (PHASE 39 positioning)', () => {
  it('does not claim Meridian is a bank, exchange, licensed broker, payment institution, or settlement provider', () => {
    const claimPatterns = [
      /Meridian is (a |an )?(licensed )?(bank|exchange|broker|payment institution|settlement provider)/i,
      /operate as (a |an )?(licensed )?(bank|exchange|broker)/i,
    ];
    for (const pattern of claimPatterns) {
      expect(layout).not.toMatch(pattern);
      expect(landing).not.toMatch(pattern);
    }
  });

  it('states that Meridian does not execute or settle', () => {
    expect(layout).toMatch(/does not execute, settle, or custody funds/i);
    expect(landing).toMatch(/does not execute or delegate settlement/i);
  });

  it('does not claim a licensed partner is already connected', () => {
    expect(landing).not.toMatch(/delegated to licensed partners/i);
    expect(landing).toMatch(/until a licensed partner is connected/i);
    expect(bestRoute).not.toMatch(/through licensed partners/i);
    expect(routeCard).not.toMatch(/through licensed on-ramp/i);
  });
});
