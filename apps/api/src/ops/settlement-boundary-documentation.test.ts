import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOUNDARY_MODES,
  FORBIDDEN_SETTLEMENT_INSTRUCTION_KEYS,
  INSTRUCTION_VERIFICATION_STEPS,
  MERIDIAN_SIGNATURE_ATTESTS,
  MERIDIAN_SIGNATURE_DOES_NOT_ATTEST,
  REVENUE_ORIGIN_ENVS,
  SETTLEMENT_INSTRUCTION_PAYLOAD_KEYS,
  SETTLEMENT_INSTRUCTION_VERSION,
  SETTLEMENT_JWKS_PATH,
} from '@meridian/core';
import { describe, expect, it } from 'vitest';
import { API_V1_ROUTE_CATALOG } from '../openapi/catalog.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const boundaryDoc = readFileSync(join(repoRoot, 'docs/SETTLEMENT_BOUNDARY.md'), 'utf8');
const apiDoc = readFileSync(join(repoRoot, 'docs/API.md'), 'utf8');

/**
 * §9-C.3 requires the Pattern A/B handoff to be *documented*, because an artifact a customer cannot
 * work out how to verify is not usable by the party it exists for.
 *
 * These assertions keep the document honest as the code moves. The signature semantics are the
 * important case: they are compared against the constants embedded in every signed payload, so
 * softening the disclaimer in code without updating the doc — or the reverse — fails here.
 */
describe('docs/SETTLEMENT_BOUNDARY.md documents the boundary it is the reference for', () => {
  it('quotes the signature semantics exactly as the signed bytes state them', () => {
    expect(boundaryDoc).toContain(MERIDIAN_SIGNATURE_ATTESTS);
    expect(boundaryDoc).toContain(MERIDIAN_SIGNATURE_DOES_NOT_ATTEST);
  });

  it('documents both boundary modes and claims no third exists', () => {
    for (const mode of BOUNDARY_MODES) {
      expect(boundaryDoc, `undocumented boundary mode ${mode}`).toContain(`\`${mode}\``);
    }
    expect(boundaryDoc).toMatch(/no third value/i);
  });

  it('names every field group a version-1 payload carries', () => {
    // Not every leaf, but every top-level group: a customer reading this must be able to tell what
    // the signature covers.
    for (const key of SETTLEMENT_INSTRUCTION_PAYLOAD_KEYS) {
      expect(boundaryDoc, `payload key ${key} is undocumented`).toContain(key);
    }
    expect(boundaryDoc).toContain(`\`"${SETTLEMENT_INSTRUCTION_VERSION}"\``);
  });

  it('gives the verification procedure the artifact itself ships', () => {
    // The steps are shipped in `nextSteps` on every instruction; the doc is the long form. Both
    // must describe the same operations in the same order.
    expect(INSTRUCTION_VERIFICATION_STEPS.length).toBeGreaterThan(0);
    for (const operation of ['Canonicalize', 'SHA-256', 'Ed25519', 'jwksUri', 'expiresAt']) {
      expect(boundaryDoc, `procedure omits ${operation}`).toContain(operation);
    }
  });

  it('states that identifiers are refused rather than merely omitted', () => {
    expect(boundaryDoc).toContain('FORBIDDEN_SETTLEMENT_INSTRUCTION_KEYS');
    for (const forbidden of ['iban', 'wallet', 'beneficiary'] as const) {
      expect(
        FORBIDDEN_SETTLEMENT_INSTRUCTION_KEYS as readonly string[],
        `${forbidden} is documented as refused but is not on the list`,
      ).toContain(forbidden);
    }
  });

  it('names the JWKS path the artifact points verifiers at', () => {
    expect(boundaryDoc).toContain(SETTLEMENT_JWKS_PATH);
    expect(apiDoc).toContain(SETTLEMENT_JWKS_PATH.replace('/api/v1', ''));
  });

  it('explains that retired keys stay verifiable after rotation', () => {
    // `\s+` rather than a literal space: markdown reflows, and a doc test that breaks when a
    // sentence rewraps teaches people to delete doc tests.
    expect(boundaryDoc).toMatch(/retired\s+public\s+keys\s+stay\s+published/i);
    expect(apiDoc).toMatch(/retired\s+keys\s+stay\s+published/i);
  });

  it('documents every origin environment an instruction can be stamped with', () => {
    for (const env of REVENUE_ORIGIN_ENVS) {
      expect(boundaryDoc, `origin env ${env} is undocumented`).toContain(`\`${env}\``);
    }
  });

  it('records that /executions is still 501 and Meridian never transmits', () => {
    expect(boundaryDoc).toMatch(/`501`/);
    expect(boundaryDoc).toMatch(/never (moves|transmit)/i);
    expect(apiDoc).toContain('not a payment authorization');
  });

  it('states that returning an instruction does not advance revenue', () => {
    // The Phase 8-A linkage. A signed artifact in a customer's hands is not cash received, and the
    // doc has to say so where an integrator will read it.
    expect(boundaryDoc).toContain('ATTRIBUTED_REVENUE');
    expect(boundaryDoc).toContain('REALIZED_REVENUE');
    expect(apiDoc).toContain('ATTRIBUTED_REVENUE');
  });

  it('lists every settlement route the API actually serves', () => {
    const settlementRoutes = API_V1_ROUTE_CATALOG.filter((route) =>
      route.path.startsWith('/settlement/'),
    );
    expect(settlementRoutes.length).toBeGreaterThan(0);
    for (const route of settlementRoutes) {
      const documented = `/api/v1${route.path}`;
      expect(boundaryDoc, `${route.method} ${route.path} is undocumented`).toContain(documented);
      expect(apiDoc, `${route.method} ${route.path} is missing from API.md`).toContain(
        documented,
      );
    }
  });
});
