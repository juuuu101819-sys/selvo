import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BILLING_LIVE_SCOPE_KEY,
  GO_LIVE_CHECKLIST_CORRIDORS,
  GO_LIVE_CHECKLIST_PATH,
  PLATFORM_WIDE_SCOPES,
  PRICING_SHAPE_ENABLEMENT_SCOPE,
  requiredChecklistRef,
  type LiveEnablementScope,
} from '@meridian/core';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const checklist = readFileSync(join(repoRoot, GO_LIVE_CHECKLIST_PATH), 'utf8');

/** The anchor a `checklistRef` points at, e.g. `#billing-collection`. */
function anchorOf(ref: string): string {
  const [, anchor] = ref.split('#');
  return anchor ?? '';
}

function sectionExists(ref: string): boolean {
  return checklist.includes(`{#${anchorOf(ref)}}`);
}

describe('every gated activity has a checklist section to point at', () => {
  it('resolves each platform-wide scope to a section that exists', () => {
    for (const scope of PLATFORM_WIDE_SCOPES) {
      const ref = requiredChecklistRef(scope, BILLING_LIVE_SCOPE_KEY);
      expect(sectionExists(ref), `${GO_LIVE_CHECKLIST_PATH} has no section for ${ref}`).toBe(true);
    }
  });

  it('resolves each live-enablable corridor to a section that exists', () => {
    for (const corridor of GO_LIVE_CHECKLIST_CORRIDORS) {
      const ref = requiredChecklistRef('corridor', corridor);
      expect(sectionExists(ref), `${GO_LIVE_CHECKLIST_PATH} has no section for ${ref}`).toBe(true);
    }
  });

  it('resolves the partner scope to a section that exists', () => {
    expect(sectionExists(requiredChecklistRef('partner', 'any-partner'))).toBe(true);
  });

  it('gives each high-risk pricing shape its own section, not a shared one', () => {
    // §18.4 requires one determination per activity. Two shapes sharing an anchor would mean one
    // approval implicitly covering both, which is the exact substitution the scopes exist to stop.
    const scopes = Object.values(PRICING_SHAPE_ENABLEMENT_SCOPE).filter(
      (scope): scope is LiveEnablementScope => scope !== null,
    );
    const anchors = scopes.map((scope) =>
      anchorOf(requiredChecklistRef(scope, BILLING_LIVE_SCOPE_KEY)),
    );
    expect(anchors).toHaveLength(3);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(anchors).not.toContain(anchorOf(requiredChecklistRef('billing', BILLING_LIVE_SCOPE_KEY)));
  });

  it('states the default-off flag next to each pricing section it gates', () => {
    // The section is the thing an operator reads before flipping a flag; if it does not name the
    // flag and its default, the document is not actually the gate.
    for (const flag of [
      'AD_VALOREM_PRICING_ENABLED',
      'GAIN_SHARE_ENABLED',
      'TPV_PRICING_ENABLED',
    ]) {
      expect(checklist).toContain(flag);
    }
  });
});
