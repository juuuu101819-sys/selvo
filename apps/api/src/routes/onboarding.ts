import {
  ManualReviewKybVendor,
  NotFoundError,
  ValidationError,
  hashPassword,
  hashSecret,
  isForbiddenProductionSecret,
  randomToken,
  uuidIdGenerator,
  type KybVendor,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../container.js';
import { requireKeyManager, requireOrganization } from '../http/require-organization.js';
import { parseOrThrow } from '../http/validation.js';
import { ONBOARDING_OPERATOR_HEADER, requireOnboardingOperator } from '../onboarding/operator.js';

const INVITE_PREFIX = 'miv_';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SLUG = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'slug must be 3–64 lowercase letters, digits, or hyphens');

const createOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: SLUG,
    countryCode: z
      .string()
      .trim()
      .length(2)
      .regex(/^[A-Za-z]{2}$/)
      .transform((value) => value.toUpperCase()),
    ownerEmail: z.string().trim().email().max(320),
    ownerDisplayName: z.string().trim().min(1).max(120),
  })
  .strict();

const acceptInviteSchema = z
  .object({
    token: z.string().min(16).max(256),
    password: z.string().min(12).max(128).optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const reviewKybSchema = z
  .object({
    status: z.enum(['verified', 'rejected']),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();

const configurePricingSchema = z
  .object({
    markupBps: z.string().regex(/^\d+(\.\d{1,4})?$/, 'markupBps must be an explicit non-negative decimal'),
    discountBps: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
    platformFeeMinorUnits: z.string().regex(/^\d+$/).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

const orgIdParams = z.object({ id: z.string().min(1).max(128) }).strict();

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

function operatorSecret(): string | undefined {
  const value = process.env['ONBOARDING_OPERATOR_SECRET'];
  return value === undefined || value.trim() === '' ? undefined : value;
}

function presentedOperatorKey(request: FastifyRequest): string | undefined {
  const header = request.headers[ONBOARDING_OPERATOR_HEADER];
  return typeof header === 'string' ? header : undefined;
}

/**
 * Sales-assisted B2B onboarding. Self-service signup is not offered.
 * KYB is manual-review until a vendor is contractually confirmed. Pricing uses existing
 * CustomerPricing rows — never a silent default take-rate.
 */
export function registerOnboardingRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });
  const kybVendor: KybVendor = new ManualReviewKybVendor();

  app.post('/ops/onboarding/organizations', async (request, reply) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const body = parseOrThrow(createOrganizationSchema, request.body, 'body');
    const existingSlug = await container.persistence.identity.findOrganizationBySlug(body.slug);
    if (existingSlug !== null) {
      throw new ValidationError('That organization slug is already in use.', { slug: body.slug });
    }

    const organizationId = uuidIdGenerator.generate('org');
    await container.persistence.identity.upsertOrganization({
      id: organizationId,
      name: body.name,
      slug: body.slug,
      countryCode: body.countryCode,
    });

    const email = body.ownerEmail.trim().toLowerCase();
    let user = await container.persistence.identity.findUserByEmail(email);
    if (user === null) {
      const userId = uuidIdGenerator.generate('usr');
      await container.persistence.identity.upsertUser({
        id: userId,
        email,
        displayName: body.ownerDisplayName,
        passwordHash: null,
      });
      user = await container.persistence.identity.findUserById(userId);
    }
    if (user === null) {
      throw new ValidationError('Could not create the invited owner.');
    }

    const existingMembership = await container.persistence.identity.findActiveMembership(
      user.id,
      organizationId,
    );
    if (existingMembership !== null) {
      throw new ValidationError('That person is already an active member of this organization.');
    }

    const token = randomToken(INVITE_PREFIX);
    const inviteId = uuidIdGenerator.generate('inv');
    const expiresAt = new Date(container.clock.nowMs() + INVITE_TTL_MS).toISOString();

    await container.persistence.identity.upsertMembership({
      id: inviteId,
      organizationId,
      userId: user.id,
      role: 'owner',
      status: 'invited',
    });
    await container.persistence.onboarding.createInvite({
      id: inviteId,
      organizationId,
      email,
      role: 'owner',
      tokenHash: hashSecret(token),
      tokenPrefix: token.slice(0, 8),
      expiresAt,
      createdByActor: 'onboarding_operator',
    });

    await container.auditLogger.record({
      type: 'onboarding.organization.created',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      organizationId,
      payload: { slug: body.slug, kybStatus: 'unverified', pricingConfigured: false },
    });
    await container.auditLogger.record({
      type: 'onboarding.invite.issued',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      organizationId,
      payload: { inviteId, email, role: 'owner', expiresAt, tokenPrefix: token.slice(0, 8) },
    });

    return reply.status(201).send(
      envelope(request, {
        organizationId,
        slug: body.slug,
        kybStatus: 'unverified',
        pricingConfigured: false,
        invite: { id: inviteId, token, expiresAt, email, role: 'owner' as const },
      }),
    );
  });

  app.post('/onboarding/invites/accept', async (request, reply) => {
    const body = parseOrThrow(acceptInviteSchema, request.body, 'body');
    const invite = await container.persistence.onboarding.findValidInviteByTokenHash(
      hashSecret(body.token),
      container.clock.nowIso(),
    );
    if (invite === null) {
      throw new ValidationError('This invite is invalid or has expired.');
    }
    if (body.password !== undefined && isForbiddenProductionSecret(body.password)) {
      throw new ValidationError('Choose a password that is not a documented demo secret.');
    }

    const user = await container.persistence.identity.findUserByEmail(invite.email);
    if (user === null) {
      throw new ValidationError('This invite is invalid or has expired.');
    }
    if (user.passwordHash === null) {
      if (body.password === undefined) {
        throw new ValidationError('A password is required to accept this invite.');
      }
      await container.persistence.identity.upsertUser({
        id: user.id,
        email: user.email,
        displayName: body.displayName ?? user.displayName,
        passwordHash: await hashPassword(body.password),
      });
    }

    await container.persistence.identity.upsertMembership({
      id: invite.id,
      organizationId: invite.organizationId,
      userId: user.id,
      role: invite.role,
      status: 'active',
    });
    const accepted = await container.persistence.onboarding.markInviteAccepted(
      invite.id,
      container.clock.nowIso(),
    );
    if (!accepted) {
      throw new ValidationError('This invite is invalid or has expired.');
    }

    await container.auditLogger.record({
      type: 'onboarding.invite.accepted',
      actor: user.id,
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      organizationId: invite.organizationId,
      payload: { inviteId: invite.id, email: invite.email },
    });

    return reply.status(201).send(
      envelope(request, { organizationId: invite.organizationId, email: invite.email, accepted: true }),
    );
  });

  app.get('/dashboard/onboarding', async (request) => {
    const principal = requireOrganization(request);
    const snapshot = await container.persistence.onboarding.snapshot(
      principal.organizationId,
      container.clock.nowIso(),
      container.config.productionGates.routingAvailable,
    );
    if (snapshot === null) {
      throw new NotFoundError('Organization', principal.organizationId);
    }
    return envelope(request, snapshot);
  });

  app.post('/dashboard/onboarding/kyb/submit', async (request, reply) => {
    const principal = requireKeyManager(request);
    const organization = await container.persistence.identity.findOrganization(
      principal.organizationId,
    );
    if (organization === null) {
      throw new NotFoundError('Organization', principal.organizationId);
    }
    if (organization.kybStatus !== 'unverified') {
      throw new ValidationError('KYB can only be submitted while unverified.', {
        kybStatus: organization.kybStatus,
      });
    }

    try {
      await kybVendor.submitForReview({
        organizationId: principal.organizationId,
        countryCode: organization.countryCode,
      });
    } catch (error) {
      await container.auditLogger.record({
        type: 'onboarding.kyb.submitted',
        actor: principal.actor,
        requestId: request.id,
        comparisonId: null,
        providerId: null,
        organizationId: principal.organizationId,
        payload: { vendorId: kybVendor.id, failed: true, kybStatus: organization.kybStatus },
      });
      throw error;
    }

    const submitted = await container.persistence.onboarding.submitKyb(
      principal.organizationId,
      container.clock.nowIso(),
    );
    await container.auditLogger.record({
      type: 'onboarding.kyb.submitted',
      actor: principal.actor,
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      organizationId: principal.organizationId,
      payload: {
        vendorId: kybVendor.id,
        previous: submitted?.previous ?? 'unverified',
        next: submitted?.next ?? 'pending',
        autoApproved: false,
      },
    });
    return reply.status(201).send(
      envelope(request, { kybStatus: submitted?.next ?? 'pending', vendorId: kybVendor.id }),
    );
  });

  app.post('/ops/onboarding/organizations/:id/kyb', async (request, reply) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const { id } = parseOrThrow(orgIdParams, request.params, 'params');
    const body = parseOrThrow(reviewKybSchema, request.body, 'body');
    const next = await container.persistence.onboarding.reviewKyb({
      organizationId: id,
      status: body.status,
      reason: body.reason,
      actor: 'onboarding_operator',
      nowIso: container.clock.nowIso(),
    });
    if (next === null) {
      throw new NotFoundError('Organization', id);
    }
    await container.auditLogger.record({
      type: 'onboarding.kyb.reviewed',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      organizationId: id,
      payload: { status: next, reason: body.reason, vendorId: 'manual_review' },
    });
    return reply.send(envelope(request, { organizationId: id, kybStatus: next, reason: body.reason }));
  });

  app.post('/ops/onboarding/organizations/:id/pricing', async (request, reply) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const { id } = parseOrThrow(orgIdParams, request.params, 'params');
    const body = parseOrThrow(configurePricingSchema, request.body, 'body');
    const org = await container.persistence.identity.findOrganization(id);
    if (org === null) {
      throw new NotFoundError('Organization', id);
    }
    const pricingId = uuidIdGenerator.generate('prc');
    const nowIso = container.clock.nowIso();
    await container.persistence.onboarding.insertNegotiatedPricing({
      id: pricingId,
      organizationId: id,
      markupBps: body.markupBps,
      discountBps: body.discountBps ?? '0',
      platformFeeMinorUnits: body.platformFeeMinorUnits ?? '0',
      feeCurrency: null,
      sourceCurrency: null,
      targetCurrency: null,
      rail: null,
      notes: body.notes ?? 'Explicit sales-assisted CustomerPricing rule. Not a silent default.',
      effectiveFrom: nowIso,
    });
    await container.auditLogger.record({
      type: 'onboarding.pricing.configured',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      organizationId: id,
      payload: { pricingId, markupBps: body.markupBps, silentDefault: false },
    });
    return reply.status(201).send(
      envelope(request, { organizationId: id, pricingId, pricingConfigured: true }),
    );
  });
}
