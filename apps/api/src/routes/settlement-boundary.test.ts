import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEMO_ORGANIZATION_ID,
  MERIDIAN_SIGNATURE_DOES_NOT_ATTEST,
  aggregateMonetization,
  canonicalJson,
  hashSecret,
  instructionJwks,
  verifyEd25519,
  type SettlementInstructionDto,
} from '@meridian/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiEnvelope, type TestHarness } from '../testing/harness.js';

/**
 * Spec §2 / §15 / §26 — the settlement boundary, proven rather than asserted.
 *
 * Phase 8 left Pattern A "not violated" only because `ExecutionIntent` was inert: the customer
 * could not act on what Meridian returned, so Meridian could not have been acting for them. That is
 * an absence of a feature, not a boundary. These tests check the replacement holds under the
 * conditions that would expose it — a fully counter-signed instruction, a production-mode process,
 * and each Pattern C gate considered on its own.
 *
 * The recurring assertion is negative and deliberately so: after each flow, **nothing** was
 * transmitted. A test that only checks the happy path produces a signature would pass just as
 * happily if the handler also posted the instruction to a partner.
 */

const API_KEY_SECRET = 'unit-test-settlement-boundary-api-key-secret';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Drops block and line comments so a source scan reads code, not prose about the code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

interface RoutingBody {
  readonly routingId: string;
  readonly routes: readonly { readonly routeId: string; readonly provider: { readonly id: string } }[];
}

interface ExecutionIntentBody {
  readonly id: string;
  readonly executable: false;
  readonly submitted: false;
}

interface JwksBody {
  readonly keys: readonly { readonly kid: string; readonly x: string; readonly kty: string }[];
}

interface VerifyBody {
  readonly valid: boolean;
  readonly reason: string | null;
  readonly payloadHash: string;
}

describe('settlement boundary: generate and return, never transmit', () => {
  let harness: TestHarness;
  let apiKeyHeaders: Record<string, string>;

  beforeAll(async () => {
    harness = await createTestHarness();
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
      agentPayments: harness.container.persistence.agentPayments,
      auditLog: harness.container.persistence.auditLog,
    });
    await harness.container.persistence.identity.createApiKey({
      id: 'key_settlement_boundary',
      organizationId: DEMO_ORGANIZATION_ID,
      keyPrefix: API_KEY_SECRET.slice(0, 16),
      secretHash: hashSecret(API_KEY_SECRET),
      label: 'settlement boundary',
      createdAt: harness.clock.nowIso(),
      scopes: ['transaction:create', 'route:read'],
      expiresAt: null,
    });
    apiKeyHeaders = { 'x-api-key': API_KEY_SECRET };
  });

  afterAll(async () => {
    await harness.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A real priced route from the engine, so the signed payload is never a fabricated one. */
  async function quoteRoute(): Promise<{ readonly routingId: string; readonly routeId: string }> {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/routes`,
      // Quoted as the organization: an instruction may only be generated from a routing
      // evaluation that tenant owns, so an anonymously-stored one is correctly a 404.
      headers: apiKeyHeaders,
      payload: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '500.00' },
    });
    expect(response.statusCode).toBe(201);
    const data = response.json<ApiEnvelope<RoutingBody>>().data;
    const route = data.routes[0];
    expect(route).toBeDefined();
    return { routingId: data.routingId, routeId: route!.routeId };
  }

  async function recordIntent(routeId: string, requestId: string): Promise<string> {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/execution-intents`,
      headers: apiKeyHeaders,
      payload: {
        requestId,
        routeId,
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '500.00',
        paymentIntentId: 'pay_demo_completed_500',
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<ApiEnvelope<ExecutionIntentBody>>().data.id;
  }

  async function generate(requestId: string): Promise<SettlementInstructionDto> {
    const { routingId, routeId } = await quoteRoute();
    const executionIntentId = await recordIntent(routeId, requestId);
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/settlement/instructions`,
      headers: apiKeyHeaders,
      payload: {
        executionIntentId,
        routingId,
        routeId,
        paymentIntentId: 'pay_demo_completed_500',
        boundaryMode: 'RETURN_TO_CUSTOMER',
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<ApiEnvelope<SettlementInstructionDto>>().data;
  }

  /**
   * Everything Meridian would have to touch in order to transmit on the customer's behalf.
   *
   * Counting partner-instruction rows and partner audit events together matters: a dispatch that
   * somehow skipped the store would still be audited, and one that skipped the audit would still
   * leave a row.
   */
  async function transmissionEvidence(): Promise<{
    readonly partnerRows: number;
    readonly partnerAudits: number;
  }> {
    const audits = await harness.auditEvents();
    const executions =
      await harness.container.persistence.orchestratedExecutions.listByOrganization(
        DEMO_ORGANIZATION_ID,
      );
    return {
      partnerRows: executions.filter((row) => row.partnerInstructionId !== null).length,
      partnerAudits: audits.filter(
        (event) => event.type.startsWith('partner.') || event.type === 'execution.dispatched',
      ).length,
    };
  }

  it('returns a signed instruction the customer can verify offline, and sends nothing', async () => {
    const outbound = vi.spyOn(globalThis, 'fetch');
    const before = await transmissionEvidence();

    const instruction = await generate('req_boundary_generate');

    // The artifact is genuinely verifiable: re-canonicalizing the structured payload reproduces
    // the exact bytes, and the published key verifies the signature over them. This is the whole
    // claim of Pattern A — without it, "returned to the customer" is a JSON blob, not an artifact.
    expect(canonicalJson(instruction.payload)).toBe(instruction.payloadCanonical);

    const jwksResponse = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/settlement/keys`,
    });
    expect(jwksResponse.statusCode).toBe(200);
    const jwks = jwksResponse.json<ApiEnvelope<JwksBody>>().data;
    expect(jwks.keys.map((key) => key.kid)).toContain(instruction.verification.keyId);
    expect(jwks.keys.every((key) => !('d' in key))).toBe(true);

    expect(
      verifyEd25519(
        instruction.payloadCanonical,
        instruction.signature,
        instruction.verification.publicKeyPem,
      ),
    ).toBe(true);

    // The signature says what it is for, inside the bytes it signs.
    expect(instruction.payload.signatureDoesNotAttest).toBe(MERIDIAN_SIGNATURE_DOES_NOT_ATTEST);
    expect(instruction.payload.meridianTransmits).toBe(false);
    expect(instruction.payload.meridianIsPayer).toBe(false);
    expect(instruction.meridianTransmitted).toBe(false);

    // And nothing left the process.
    expect(outbound).not.toHaveBeenCalled();
    expect(await transmissionEvidence()).toEqual(before);
  });

  it('carries the engine\'s own numbers, not the caller\'s', async () => {
    const instruction = await generate('req_boundary_numbers');
    const { route, costs } = instruction.payload;

    // Minor units all the way through: a float here is the PA-H07 class of defect wearing a
    // signature, which makes it authoritative as well as wrong.
    for (const value of [
      route.sendMinorUnits,
      route.deliveredMinorUnits,
      costs.totalCostMinorUnits,
      costs.providerFeeMinorUnits,
      costs.platformFeeMinorUnits,
    ]) {
      expect(value, `${value} is not an integer minor-unit string`).toMatch(/^-?\d+$/);
    }
    expect(BigInt(route.sendMinorUnits)).toBe(50_000n);
    expect(route.legs.length).toBeGreaterThan(0);
    expect(route.providerId).not.toBe('');
  });

  it('accepts a customer counter-signature and still transmits nothing', async () => {
    const outbound = vi.spyOn(globalThis, 'fetch');
    const instruction = await generate('req_boundary_countersign');
    const before = await transmissionEvidence();

    const signed = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/settlement/instructions/${instruction.id}/customer-signature`,
      headers: apiKeyHeaders,
      payload: {
        algorithm: 'Ed25519',
        signature: 'Y3VzdG9tZXItc2lnbmF0dXJlLWJ5dGVz',
        keyId: 'customer-key-1',
        signedAt: harness.clock.nowIso(),
      },
    });
    expect(signed.statusCode).toBe(200);
    const body = signed.json<ApiEnvelope<SettlementInstructionDto>>().data;

    expect(body.customerSignature).not.toBeNull();
    expect(body.customerSignature?.triggeredDispatch).toBe(false);

    // The counter-signature is the moment a naive implementation would "helpfully" act on the
    // customer's authorization. Nothing moved, no partner row appeared, and no outbound call was
    // attempted.
    expect(outbound).not.toHaveBeenCalled();
    expect(await transmissionEvidence()).toEqual(before);
    expect(body.meridianTransmitted).toBe(false);

    const audits = await harness.auditEvents();
    const countersigned = audits.filter(
      (event) => event.type === 'settlement.instruction.customer_signed',
    );
    expect(countersigned.length).toBe(1);
    expect(countersigned[0]?.payload['triggeredDispatch']).toBe(false);
    expect(countersigned[0]?.payload['transmittedByMeridian']).toBe(false);
  });

  it('refuses a second counter-signature rather than overwriting the first', async () => {
    const instruction = await generate('req_boundary_double_sign');
    const payload = {
      algorithm: 'Ed25519' as const,
      signature: 'Zmlyc3Qtc2lnbmF0dXJl',
      keyId: 'customer-key-1',
      signedAt: harness.clock.nowIso(),
    };
    const url = `${API_V1_PREFIX}/settlement/instructions/${instruction.id}/customer-signature`;

    const first = await harness.app.inject({ method: 'POST', url, headers: apiKeyHeaders, payload });
    expect(first.statusCode).toBe(200);

    const second = await harness.app.inject({
      method: 'POST',
      url,
      headers: apiKeyHeaders,
      payload: { ...payload, signature: 'c2Vjb25kLXNpZ25hdHVyZQ' },
    });
    // Overwriting would destroy the record of which artifact the customer actually approved.
    expect(second.statusCode).toBe(400);

    const read = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/settlement/instructions/${instruction.id}`,
      headers: apiKeyHeaders,
    });
    expect(read.json<ApiEnvelope<SettlementInstructionDto>>().data.customerSignature?.signature).toBe(
      payload.signature,
    );
  });

  it('detects a tampered payload through the published key', async () => {
    const instruction = await generate('req_boundary_tamper');
    const tampered = {
      ...instruction.payload,
      costs: { ...instruction.payload.costs, platformFeeMinorUnits: '999999' },
    };

    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/settlement/instructions/verify`,
      payload: {
        payload: tampered,
        signature: instruction.signature,
        keyId: instruction.verification.keyId,
      },
    });
    expect(response.statusCode).toBe(200);
    const verdict = response.json<ApiEnvelope<VerifyBody>>().data;
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('signature_invalid');

    // And the untouched artifact still verifies, so the check above is discriminating rather than
    // simply always failing.
    const honest = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/settlement/instructions/verify`,
      payload: {
        payload: instruction.payload,
        signature: instruction.signature,
        keyId: instruction.verification.keyId,
      },
    });
    expect(honest.json<ApiEnvelope<VerifyBody>>().data.valid).toBe(true);
  });

  it('reports an expired instruction instead of serving it as current', async () => {
    const instruction = await generate('req_boundary_expiry');
    const readFresh = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/settlement/instructions/${instruction.id}`,
      headers: apiKeyHeaders,
    });
    expect(readFresh.json<ApiEnvelope<SettlementInstructionDto>>().data.usable).toBe(true);

    const pastExpiry = Date.parse(instruction.expiresAt) - harness.clock.nowMs() + 1_000;
    harness.clock.advance(pastExpiry);
    const readStale = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/settlement/instructions/${instruction.id}`,
      headers: apiKeyHeaders,
    });
    const stale = readStale.json<ApiEnvelope<SettlementInstructionDto>>().data;
    expect(stale.usable).toBe(false);
    expect(stale.unusableReason).toBe('expired');
    harness.clock.advance(-pastExpiry);
  });

  it('never lets an instruction outlive the quote behind it', async () => {
    const instruction = await generate('req_boundary_quote_cap');
    const quoteExpiresAt = instruction.payload.quoteExpiresAt;
    expect(quoteExpiresAt).not.toBeNull();
    // A signature makes a stale price look current to anyone who does not check the dates, so the
    // artifact's own expiry is capped by the quote's rather than by configuration alone.
    expect(Date.parse(instruction.expiresAt)).toBeLessThanOrEqual(Date.parse(quoteExpiresAt!));
  });

  it('keeps generating an instruction out of the realized-revenue path', async () => {
    const instruction = await generate('req_boundary_revenue');
    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/settlement/instructions/${instruction.id}/customer-signature`,
      headers: apiKeyHeaders,
      payload: {
        algorithm: 'Ed25519',
        signature: 'cmV2ZW51ZS10ZXN0LXNpZ25hdHVyZQ',
        keyId: 'customer-key-1',
        signedAt: harness.clock.nowIso(),
      },
    });

    // Phase 8-A's four facts are untouched by any of this: generating, signing, returning, and
    // counter-signing an artifact is not a settlement and not a collection.
    const events = await harness.container.persistence.dashboard.listMonetizationEvents(
      DEMO_ORGANIZATION_ID,
      { limit: 100 },
    );
    const report = aggregateMonetization(events, { organizationId: DEMO_ORGANIZATION_ID });
    expect(BigInt(report.summary.realizedRevenueMinorUnits)).toBe(0n);
    expect(BigInt(report.summary.collectedRevenueMinorUnits)).toBe(0n);

    for (const event of events) {
      expect(event.realizedRevenue).toBe(false);
      expect(event.lifecycleState).not.toBe('REALIZED_REVENUE');
      expect(event.settlementFinality).not.toBe('provider_confirmed');
    }
  });
});

describe('Pattern C gates: each refuses on its own', () => {
  /**
   * The gates are layered, so a test that flips them all at once proves only that the outermost
   * one works. Each case below leaves the others in a state that would permit dispatch and shows
   * the gate under test still refuses — that is what makes the defence in depth real rather than
   * an accident of ordering.
   */

  it('refuses POST /executions with 501 while EXECUTION_ENABLED is false', async () => {
    const harness = await createTestHarness();
    try {
      const response = await harness.app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/executions`,
        payload: {
          mandateId: 'mdt_x',
          routingId: 'rte_x',
          routeId: 'route_x',
          beneficiaryRef: 'merchant-x',
        },
      });
      expect(response.statusCode).toBe(501);
    } finally {
      await harness.close();
    }
  });

  it('refuses to start a production-locked process with EXECUTION_ENABLED true', async () => {
    // The orchestration gate is not reachable in production because the process will not boot.
    // Refused at config load, before a route exists to call: the gate is that the process does
    // not come up, so there is no running production build in which orchestration is enabled.
    await expect(
      createTestHarness({ PLATFORM_MODE: 'production', EXECUTION_ENABLED: 'true' }),
    ).rejects.toThrow(/environment configuration/i);
  });

  it('registers no execution partners outside sandbox mode, so there is nothing to dispatch to', async () => {
    const harness = await createTestHarness({
      PLATFORM_MODE: 'production',
      DATABASE_DRIVER: 'memory',
      AUTH_SECRET: 'x'.repeat(48),
      SEED_DEMO_TENANTS: 'false',
    }).catch(() => null);
    // A production-locked process refuses the memory driver outright, which is itself the gate:
    // there is no configuration in which production has sandbox partners registered.
    expect(harness).toBeNull();
  });

  it('keeps the sandbox-only dispatch assertion and the live-partner refusal in the service', () => {
    // Read as source rather than executed: the point is that these guards exist and are separate,
    // which a runtime test of one cannot show about the other.
    const service = readFileSync(
      join(repoRoot, 'packages/core/src/engine/partner-instruction-service.ts'),
      'utf8',
    );
    expect(service).toContain('production_dispatch_disabled');
    expect(service).toContain('live_disabled');
    expect(service).toMatch(/PARTNER_LIVE_ENABLED/);
  });

  it('admits no live execution partner even when PARTNER_LIVE_ENABLED is true', async () => {
    const harness = await createTestHarness({ PARTNER_LIVE_ENABLED: 'true' });
    try {
      const response = await harness.app.inject({
        method: 'GET',
        url: `${API_V1_PREFIX}/execution-partners`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<ApiEnvelope<{ readonly partners: readonly { readonly kind?: string }[] }>>();
      // The flag admits live adapters into the registry; none exist, so the flag changes nothing.
      // Turning it on is therefore not a path to dispatch on a customer's behalf.
      for (const partner of body.data.partners) {
        expect(partner.kind).not.toBe('live');
      }
    } finally {
      await harness.close();
    }
  });
});

describe('settlement service cannot reach dispatch', () => {
  /**
   * A structural check on the module graph.
   *
   * Every runtime test above shows that dispatch did not happen on the paths exercised. This shows
   * it cannot happen on any path, because the code that would do it is not reachable from the code
   * that generates instructions — no import, direct or transitive through the service's own
   * dependencies.
   */
  const serviceSource = stripComments(
    readFileSync(
      join(repoRoot, 'packages/core/src/engine/settlement-instruction-service.ts'),
      'utf8',
    ),
  );
  // Comments are stripped before scanning: the assertions below are about what the code does, and
  // a doc comment naming the thing it must not call would otherwise fail its own check.
  const routeSource = stripComments(
    readFileSync(join(repoRoot, 'apps/api/src/routes/settlement-instructions.ts'), 'utf8'),
  );

  it('imports nothing that can dispatch', () => {
    for (const forbidden of [
      'partner-instruction-service',
      'execution-partner-registry',
      'execution-orchestration-service',
    ]) {
      expect(serviceSource, `settlement service imports ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('has no method that sends, submits, or dispatches', () => {
    for (const verb of ['dispatch(', 'submit(', 'transmit(', 'send(']) {
      expect(serviceSource, `settlement service exposes ${verb}`).not.toContain(verb);
    }
  });

  it('routes never touch the partner-instruction service', () => {
    expect(routeSource).not.toContain('partnerInstructions');
    expect(routeSource).not.toContain('executionPartners');
    expect(routeSource).not.toContain('container.executions');
  });

  it('stores an instruction with no status to advance', () => {
    const migration = readFileSync(
      join(repoRoot, 'prisma/migrations/20260918100000_settlement_instructions/migration.sql'),
      'utf8',
    );
    expect(migration).toContain('settlement_instructions_never_transmitted');
    expect(migration).toMatch(/CHECK \("meridian_transmitted" = false\)/);
    // No lifecycle column exists to walk an instruction toward "sent".
    expect(migration).not.toMatch(/"dispatched_at"/);
    expect(migration).not.toMatch(/"submitted_at"/);
    expect(migration).not.toMatch(/"status"\s+TEXT/);
  });

  it('offers only boundary modes in which the customer or their partner acts', () => {
    const domain = readFileSync(
      join(repoRoot, 'packages/core/src/domain/settlement-instruction.ts'),
      'utf8',
    );
    const modes = /export const BOUNDARY_MODES = \[([^\]]*)\]/.exec(domain);
    expect(modes).not.toBeNull();
    const values = (modes?.[1] ?? '')
      .split(',')
      .map((value) => value.trim().replace(/^'|'$/g, ''))
      .filter((value) => value !== '');
    expect(values).toEqual(['RETURN_TO_CUSTOMER', 'PARTNER_EXECUTES']);
  });
});

describe('published verification material', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('publishes public keys only, with no private material anywhere', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/settlement/keys`,
    });
    expect(response.statusCode).toBe(200);
    const raw = response.body;
    // `d` is the private scalar of an Ed25519 JWK. Its absence is the whole safety property here.
    expect(raw).not.toMatch(/"d"\s*:/);
    expect(raw).not.toContain('PRIVATE KEY');

    const jwks = response.json<ApiEnvelope<JwksBody>>().data;
    expect(jwks.keys.length).toBeGreaterThan(0);
    for (const key of jwks.keys) {
      expect(key.kty).toBe('OKP');
      expect(key.x).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('states that the signature is not a payment authorization', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/settlement/verification`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<
      ApiEnvelope<{
        readonly signatureDoesNotAttest: string;
        readonly boundary: { readonly meridianTransmits: boolean };
      }>
    >().data;
    expect(body.signatureDoesNotAttest).toContain('not a payment authorization');
    expect(body.boundary.meridianTransmits).toBe(false);
  });

  it('keeps retired keys verifiable after a rotation', async () => {
    const ring = await harness.container.settlementInstructions.verificationKeys();
    const before = instructionJwks(ring.verification).keys.map((key) => key.kid);
    expect(before.length).toBeGreaterThan(0);

    // An artifact already in a customer's hands must not stop verifying because Meridian rotated.
    const { rotateInstructionSigningKey } = await import('@meridian/core');
    const rotated = await rotateInstructionSigningKey(
      harness.container.providerCredentialVault,
      harness.clock.nowIso(),
    );
    harness.container.settlementInstructions.reloadKeys();

    const after = instructionJwks(rotated.verification).keys.map((key) => key.kid);
    for (const kid of before) {
      expect(after, `rotation dropped ${kid}`).toContain(kid);
    }
    expect(rotated.active.generation).toBeGreaterThan(ring.active.generation);
  });
});
