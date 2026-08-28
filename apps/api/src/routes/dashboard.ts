import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  dataEncryptionKeyFromHex,
  encryptAtRest,
  serializeMonetizationReport,
  serializePaymentIntent,
  serializePaymentPolicy,
  uuidIdGenerator,
  type JsonObject,
  type PaymentPolicy,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../container.js';
import {
  listAgentDashboardSummaries,
  loadAgentDashboardDetail,
  loadAgentPaymentHistory,
  loadAgentPolicyControls,
} from '../dashboard/agent-financials.js';
import { publicOidcConnection } from '../auth/oidc-public.js';
import {
  capabilityPreHandler,
  requireCapability,
  requireKeyManager,
  requireOrganization,
} from '../http/require-organization.js';
import { parseOrThrow, patchAgentPolicySchema } from '../http/validation.js';

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const idParams = z.object({ id: z.string().min(1).max(128) }).strict();
const patchOrgAuthSchema = z
  .object({
    requireMfaForPrivilegedRoles: z.boolean().optional(),
    oidc: z
      .object({
        issuer: z.string().trim().url().max(2048).optional(),
        clientId: z.string().trim().min(1).max(256).optional(),
        clientSecret: z.string().min(1).max(4096).optional(),
        redirectUri: z.string().trim().url().max(2048).optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

export function registerDashboardRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.get('/dashboard/metrics', async (request) => {
    const principal = requireOrganization(request);
    const metrics = await container.persistence.dashboard.metrics(principal.organizationId);
    const volume = await container.persistence.dashboard.volumeByDay(principal.organizationId, 30);
    const cost = await container.persistence.dashboard.costByDay(principal.organizationId, 30);
    const providers = await container.persistence.dashboard.quotesByProvider(
      principal.organizationId,
    );
    return envelope(request, {
      metrics,
      charts: { volumeByDay: volume, costByDay: cost, providers },
    });
  });

  app.get('/dashboard/quotes', async (request) => {
    const principal = requireOrganization(request);
    const { limit } = parseOrThrow(listQuery, request.query, 'query');
    const quotes = await container.persistence.dashboard.listQuotes(principal.organizationId, {
      limit,
    });
    return envelope(request, { quotes });
  });

  app.get('/dashboard/quotes/:id', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(idParams, request.params, 'params');
    const quote = await container.persistence.dashboard.getQuote(principal.organizationId, id);
    if (quote === null) {
      throw new NotFoundError('Quote', id);
    }
    return envelope(request, quote);
  });

  app.get('/dashboard/transactions', async (request) => {
    const principal = requireOrganization(request);
    const { limit } = parseOrThrow(listQuery, request.query, 'query');
    const transactions = await container.persistence.dashboard.listTransactions(
      principal.organizationId,
      { limit },
    );
    return envelope(request, { transactions });
  });

  app.get('/dashboard/transactions/:id', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(idParams, request.params, 'params');
    const transaction = await container.persistence.dashboard.getTransaction(
      principal.organizationId,
      id,
    );
    if (transaction === null) {
      throw new NotFoundError('TransactionRequest', id);
    }
    return envelope(request, transaction);
  });

  app.get('/dashboard/providers', async (request) => {
    const principal = requireOrganization(request);
    const providers = await container.persistence.dashboard.quotesByProvider(
      principal.organizationId,
    );
    return envelope(request, { providers });
  });

  app.get('/dashboard/revenue', async (request) => {
    const principal = requireOrganization(request);
    const report = await container.persistence.dashboard.revenue(principal.organizationId);
    return envelope(request, serializeMonetizationReport(report));
  });

  app.get('/dashboard/settings', async (request) => {
    const principal = requireOrganization(request);
    const [organization, members, apiKeys, oidc] = await Promise.all([
      container.persistence.identity.findOrganization(principal.organizationId),
      container.persistence.identity.listMembers(principal.organizationId),
      container.persistence.identity.listApiKeys(principal.organizationId),
      container.persistence.identity.findOidcConnection(principal.organizationId),
    ]);
    return envelope(request, {
      organization,
      members,
      apiKeys,
      role: principal.roles[0] ?? null,
      auth: {
        requireMfaForPrivilegedRoles: organization?.requireMfaForPrivilegedRoles ?? false,
        oidc: publicOidcConnection(oidc),
      },
    });
  });

  app.patch('/dashboard/settings/auth', async (request) => {
    const principal = requireKeyManager(request);
    const body = parseOrThrow(patchOrgAuthSchema, request.body, 'body');
    const identity = container.persistence.identity;
    const organization = await identity.findOrganization(principal.organizationId);
    if (organization === null) {
      throw new NotFoundError('Organization', principal.organizationId);
    }

    if (body.requireMfaForPrivilegedRoles !== undefined) {
      await identity.updateOrganizationAuthSettings(principal.organizationId, {
        requireMfaForPrivilegedRoles: body.requireMfaForPrivilegedRoles,
      });
    }

    if (body.oidc !== undefined) {
      const existing = await identity.findOidcConnection(principal.organizationId);
      const issuer = body.oidc.issuer ?? existing?.issuer;
      const clientId = body.oidc.clientId ?? existing?.clientId;
      const redirectUri = body.oidc.redirectUri ?? existing?.redirectUri;
      let clientSecretCiphertext = existing?.clientSecretCiphertext ?? null;
      if (body.oidc.clientSecret !== undefined) {
        if (body.oidc.clientSecret.length === 0) {
          throw new ValidationError('OIDC client secret must not be empty.', {
            field: 'oidc.clientSecret',
          });
        }
        clientSecretCiphertext = encryptAtRest(
          body.oidc.clientSecret,
          dataEncryptionKeyFromHex(container.config.dataEncryptionKey),
        );
      }
      const enabled = body.oidc.enabled ?? existing?.enabled ?? false;
      if (issuer === undefined || clientId === undefined || redirectUri === undefined) {
        throw new ValidationError(
          'OIDC issuer, clientId, and redirectUri are required before the connection can be saved.',
          { field: 'oidc' },
        );
      }
      if (enabled && (clientSecretCiphertext === null || clientSecretCiphertext === '')) {
        throw new ValidationError('OIDC cannot be enabled without a client secret.', {
          field: 'oidc.enabled',
        });
      }
      await identity.upsertOidcConnection({
        id: existing?.id ?? uuidIdGenerator.generate('oidc'),
        organizationId: principal.organizationId,
        issuer,
        clientId,
        clientSecretCiphertext,
        redirectUri,
        enabled,
      });
    }

    const [updatedOrg, updatedOidc] = await Promise.all([
      identity.findOrganization(principal.organizationId),
      identity.findOidcConnection(principal.organizationId),
    ]);
    return envelope(request, {
      requireMfaForPrivilegedRoles: updatedOrg?.requireMfaForPrivilegedRoles ?? false,
      oidc: publicOidcConnection(updatedOidc),
    });
  });

  app.get('/dashboard/agents', async (request) => {
    const principal = requireOrganization(request);
    const agents = await listAgentDashboardSummaries({
      organizationId: principal.organizationId,
      nowIso: container.clock.nowIso(),
      agentPayments: container.persistence.agentPayments,
      auditLog: container.persistence.auditLog,
    });
    return envelope(request, {
      agents,
      fundsMoved: false,
      custody: false,
      walletsGenerated: false,
      privateKeysHeld: false,
    });
  });

  app.get('/dashboard/agents/:id', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(idParams, request.params, 'params');
    const detail = await loadAgentDashboardDetail({
      organizationId: principal.organizationId,
      agentId: id,
      nowIso: container.clock.nowIso(),
      agentPayments: container.persistence.agentPayments,
      auditLog: container.persistence.auditLog,
    });
    if (detail === null) {
      throw new NotFoundError('Agent', id);
    }
    return envelope(request, detail);
  });

  app.get('/dashboard/agents/:id/payments', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(idParams, request.params, 'params');
    const intents = await loadAgentPaymentHistory({
      organizationId: principal.organizationId,
      agentId: id,
      agentPayments: container.persistence.agentPayments,
    });
    if (intents === null) {
      throw new NotFoundError('Agent', id);
    }
    return envelope(request, {
      payments: intents.map(serializePaymentIntent),
      fundsMoved: false,
      custody: false,
    });
  });

  app.get('/dashboard/agents/:id/policies', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(idParams, request.params, 'params');
    const controls = await loadAgentPolicyControls({
      organizationId: principal.organizationId,
      agentId: id,
      nowIso: container.clock.nowIso(),
      agentPayments: container.persistence.agentPayments,
      auditLog: container.persistence.auditLog,
      providers: container.providers.map((provider) => ({ id: provider.id, name: provider.name })),
    });
    if (controls === null) {
      throw new NotFoundError('Agent', id);
    }
    return envelope(request, controls);
  });

  app.patch(
    '/dashboard/agents/:id/policies',
    { preHandler: [capabilityPreHandler('agent_policy:write')] },
    async (request) => {
    const principal = requireCapability(request, 'agent_policy:write');
    if (principal.kind === 'agent') {
      throw new ForbiddenError('Agent credentials cannot update payment policy.', {
        kind: principal.kind,
      });
    }
    const { id } = parseOrThrow(idParams, request.params, 'params');
    const body = parseOrThrow(patchAgentPolicySchema, request.body, 'body');
    const existing = await container.persistence.agentPayments.findPolicyByAgent(
      principal.organizationId,
      id,
    );
    if (existing === null) {
      const agent = await container.persistence.agentPayments.findAgent(
        id,
        principal.organizationId,
      );
      throw new NotFoundError(agent === null ? 'Agent' : 'PaymentPolicy', id);
    }
    const previousSnapshot = policyAuditSnapshot(existing);
    const updated: PaymentPolicy = {
      ...existing,
      maxTransactionAmountMinorUnits:
        body.maxTransactionAmountMinorUnits ?? existing.maxTransactionAmountMinorUnits,
      dailySpendingLimitMinorUnits:
        body.dailySpendingLimitMinorUnits ?? existing.dailySpendingLimitMinorUnits,
      dailySpendingAsset: body.dailySpendingAsset ?? existing.dailySpendingAsset,
      allowedAssets: body.allowedAssets ?? existing.allowedAssets,
      allowedRecipientCodes: body.allowedRecipientCodes ?? existing.allowedRecipientCodes,
      allowedProviderIds: body.allowedProviderIds ?? existing.allowedProviderIds,
      allowedChainIds: body.allowedChainIds ?? existing.allowedChainIds,
      allowedCountryCodes: body.allowedCountryCodes ?? existing.allowedCountryCodes,
      maxFeeBps: body.maxFeeBps ?? existing.maxFeeBps,
      maxSlippageBps: body.maxSlippageBps ?? existing.maxSlippageBps,
      minRouteScore: body.minRouteScore ?? existing.minRouteScore,
      minLiquidityHeadroom: body.minLiquidityHeadroom ?? existing.minLiquidityHeadroom,
      preferredRoutePreference:
        body.preferredRoutePreference === undefined
          ? existing.preferredRoutePreference
          : body.preferredRoutePreference,
      updatedAt: container.clock.nowIso(),
    };
    await container.persistence.agentPayments.updatePolicy(updated);
    const timestamp = container.clock.nowIso();
    await container.auditLogger.record({
      type: 'payment.policy.updated',
      actor: principal.actor,
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      organizationId: principal.organizationId,
      payload: {
        actorId: principal.subjectId,
        actorRole: principal.roles[0] ?? null,
        organizationId: principal.organizationId,
        agentId: id,
        previousPolicy: previousSnapshot,
        newPolicy: policyAuditSnapshot(updated),
        timestamp,
        fundsMoved: false,
        custody: false,
        walletsGenerated: false,
        privateKeysHeld: false,
      },
    });
    const controls = await loadAgentPolicyControls({
      organizationId: principal.organizationId,
      agentId: id,
      nowIso: container.clock.nowIso(),
      agentPayments: container.persistence.agentPayments,
      auditLog: container.persistence.auditLog,
      providers: container.providers.map((provider) => ({ id: provider.id, name: provider.name })),
    });
    if (controls === null) {
      throw new NotFoundError('Agent', id);
    }
    return envelope(request, controls);
  });
}

function policyAuditSnapshot(policy: PaymentPolicy): JsonObject {
  const parsed: unknown = JSON.parse(JSON.stringify(serializePaymentPolicy(policy)));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as JsonObject;
}
