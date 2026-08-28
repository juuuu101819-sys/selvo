import {
  DEFAULT_AGENT_SCOPES,
  DEMO_AGENT_POLICY,
  ExecutionNotImplementedError,
  NotFoundError,
  hashSecret,
  isRoutePreference,
  randomToken,
  serializeIssuedAgent,
  serializeMerchant,
  serializePaymentIntent,
  serializePaymentPolicy,
  serializePublicAgent,
  serializeWalletReference,
  uuidIdGenerator,
  type IssuedAgentDto,
  type MerchantDto,
  type PaymentIntentDto,
  type PaymentPolicyDto,
  type PublicAgentDto,
  type AgentWalletReferenceDto,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { API_KEY_PREFIX_LENGTH } from '../auth/identity-authenticator.js';
import type { AppContainer } from '../container.js';
import { recordAgentQuoteMonetization } from '../monetization/record.js';
import {
  requireKeyManager,
  requireOrganization,
  requireScope,
} from '../http/require-organization.js';
import {
  agentIdParamsSchema,
  createAgentSchema,
  createPaymentIntentSchema,
  idempotencyKeySchema,
  listQuerySchema,
  parseOrThrow,
  paymentIntentIdParamsSchema,
  selectPaymentRouteSchema,
} from '../http/validation.js';

const ISSUED_AGENT_PREFIX = 'mag_';

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

/**
 * AI-agent payment infrastructure.
 *
 * Agents create intents, request quotes from the existing multi-rail router, authorize, and run
 * the sandbox simulator. The platform never holds funds, keys or wallets. `POST /executions`
 * remains the 501.
 */
export function registerAgentPaymentRoutes(
  app: FastifyInstance,
  container: AppContainer,
): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.get('/agents/me', async (request) => {
    const principal = requireOrganization(request);
    if (principal.kind !== 'agent' || principal.subjectId === null) {
      throw new NotFoundError('Agent', 'me');
    }
    const agents = await container.persistence.agentPayments.listAgents(principal.organizationId);
    const me = agents.find((agent) => agent.id === principal.subjectId);
    if (me === undefined) {
      throw new NotFoundError('Agent', principal.subjectId);
    }
    const wallets = await container.persistence.agentPayments.listWalletReferences(
      principal.organizationId,
      me.id,
    );
    return envelope<{ agent: PublicAgentDto; wallets: readonly AgentWalletReferenceDto[] }>(
      request,
      {
        agent: serializePublicAgent(me),
        wallets: wallets.map(serializeWalletReference),
      },
    );
  });

  app.get('/agents', async (request) => {
    const principal = requireOrganization(request);
    const agents = await container.persistence.agentPayments.listAgents(principal.organizationId);
    return envelope(request, { agents: agents.map(serializePublicAgent) });
  });

  app.post('/agents', async (request, reply) => {
    const principal = requireKeyManager(request);
    const body = parseOrThrow(createAgentSchema, request.body, 'body');
    const now = container.clock.nowIso();
    const agentId = uuidIdGenerator.generate('agt');
    await container.persistence.agentPayments.createAgent({
      id: agentId,
      organizationId: principal.organizationId,
      name: body.name,
      createdAt: now,
    });

    const secret = randomToken(ISSUED_AGENT_PREFIX);
    const keyPrefix = secret.slice(0, API_KEY_PREFIX_LENGTH);
    await container.persistence.agentPayments.createCredential({
      id: uuidIdGenerator.generate('agc'),
      agentId,
      organizationId: principal.organizationId,
      keyPrefix,
      secretHash: hashSecret(secret),
      scopes: DEFAULT_AGENT_SCOPES,
      createdAt: now,
      expiresAt: null,
    });

    await container.persistence.agentPayments.createWalletReference({
      id: uuidIdGenerator.generate('awr'),
      organizationId: principal.organizationId,
      agentId,
      kind: 'external_account',
      label: 'External operating account',
      externalRef: `ext_acct_${agentId}`,
      createdAt: now,
    });

    const merchants = await container.persistence.agentPayments.listMerchants(
      principal.organizationId,
    );
    await container.persistence.agentPayments.createPolicy({
      id: uuidIdGenerator.generate('pol'),
      organizationId: principal.organizationId,
      agentId,
      ...DEMO_AGENT_POLICY,
      allowedAssets: [...DEMO_AGENT_POLICY.allowedAssets],
      allowedRecipientCodes: merchants.map((merchant) => merchant.recipientCode),
      allowedProviderIds: [...DEMO_AGENT_POLICY.allowedProviderIds],
      allowedChainIds: [...DEMO_AGENT_POLICY.allowedChainIds],
      allowedCountryCodes: [...DEMO_AGENT_POLICY.allowedCountryCodes],
      createdAt: now,
    });

    const listed = await container.persistence.agentPayments.listAgents(principal.organizationId);
    const created = listed.find((agent) => agent.id === agentId);
    if (created === undefined) {
      throw new NotFoundError('Agent', agentId);
    }

    await container.auditLogger.record({
      type: 'agent.issued',
      actor: principal.actor,
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      payload: { agentId, keyPrefix, scopes: [...DEFAULT_AGENT_SCOPES] },
    });

    return reply.status(201).send(
      envelope<IssuedAgentDto>(request, serializeIssuedAgent(created, secret)),
    );
  });

  app.post('/agents/:id/revoke', async (request) => {
    const principal = requireKeyManager(request);
    const { id } = parseOrThrow(agentIdParamsSchema, request.params, 'params');
    const now = container.clock.nowIso();
    const retired = await container.persistence.agentPayments.updateAgentStatus(
      id,
      principal.organizationId,
      'retired',
      now,
    );
    if (!retired) {
      throw new NotFoundError('Agent', id);
    }
    await container.persistence.agentPayments.revokeCredentialsForAgent(
      id,
      principal.organizationId,
      now,
    );
    await container.auditLogger.record({
      type: 'agent.revoked',
      actor: principal.actor,
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      payload: { agentId: id },
    });
    return envelope(request, { id, revoked: true });
  });

  app.get('/agents/:id/wallets', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(agentIdParamsSchema, request.params, 'params');
    if (principal.kind === 'agent' && principal.subjectId !== id) {
      throw new NotFoundError('Agent', id);
    }
    const agent = await container.persistence.agentPayments.findAgent(id, principal.organizationId);
    if (agent === null) {
      throw new NotFoundError('Agent', id);
    }
    const wallets = await container.persistence.agentPayments.listWalletReferences(
      principal.organizationId,
      id,
    );
    return envelope(request, { wallets: wallets.map(serializeWalletReference) });
  });

  app.get('/merchants', async (request) => {
    const principal = requireOrganization(request);
    const merchants = await container.persistence.agentPayments.listMerchants(
      principal.organizationId,
    );
    return envelope<{ merchants: readonly MerchantDto[] }>(request, {
      merchants: merchants.map(serializeMerchant),
    });
  });

  app.get('/payment-policies', async (request) => {
    const principal = requireOrganization(request);
    const policies = await container.persistence.agentPayments.listPolicies(
      principal.organizationId,
    );
    const scoped =
      principal.kind === 'agent' && principal.subjectId !== null
        ? policies.filter((policy) => policy.agentId === principal.subjectId)
        : policies;
    return envelope<{ policies: readonly PaymentPolicyDto[] }>(request, {
      policies: scoped.map(serializePaymentPolicy),
    });
  });

  app.post('/payment-intents', async (request, reply) => {
    const principal = requireScope(request, 'payment:create');
    const body = parseOrThrow(createPaymentIntentSchema, request.body, 'body');
    const idempotencyHeader = request.headers['idempotency-key'];
    const rawKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;
    const idempotencyKey =
      rawKey === undefined ? null : (parseOrThrow(idempotencyKeySchema, rawKey, 'headers') ?? null);

    const preference = body.routePreference;
    const intent = await container.agentPayments.createIntent({
      organizationId: principal.organizationId,
      actorAgentId: principal.kind === 'agent' ? principal.subjectId : null,
      bodyAgentId: body.agentId,
      instruction: body.instruction,
      sourceAsset: body.sourceAsset,
      destinationAsset: body.destinationAsset,
      amount: body.amount,
      recipient: body.recipient,
      purpose: body.purpose,
      routePreference:
        preference !== undefined && isRoutePreference(preference) ? preference : null,
      maxFeeBps: body.maxFeeBps ?? body.maxFee ?? null,
      expiresAt: body.expiresAt,
      idempotencyKey,
      actor: principal.actor,
      requestId: request.id,
    });

    return reply.status(201).send(
      envelope<PaymentIntentDto>(request, serializePaymentIntent(intent)),
    );
  });

  app.get('/payment-intents', async (request) => {
    const principal = requireOrganization(request);
    const query = parseOrThrow(listQuerySchema, request.query, 'query');
    const intents = await container.persistence.agentPayments.listIntents(principal.organizationId, {
      limit: query.limit,
      ...(principal.kind === 'agent' && principal.subjectId !== null
        ? { agentId: principal.subjectId }
        : {}),
    });
    return envelope(request, { paymentIntents: intents.map(serializePaymentIntent) });
  });

  app.get('/payment-intents/:id', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(paymentIntentIdParamsSchema, request.params, 'params');
    const intent = await container.agentPayments.getIntent({
      organizationId: principal.organizationId,
      agentId: principal.kind === 'agent' ? principal.subjectId : null,
      paymentIntentId: id,
    });
    return envelope(request, serializePaymentIntent(intent));
  });

  app.post('/payment-intents/:id/quote', async (request) => {
    const principal = requireScope(request, 'payment:quote');
    const { id } = parseOrThrow(paymentIntentIdParamsSchema, request.params, 'params');
    const intent = await container.agentPayments.quoteIntent({
      organizationId: principal.organizationId,
      agentId: principal.kind === 'agent' ? principal.subjectId : null,
      paymentIntentId: id,
      actor: principal.actor,
      requestId: request.id,
    });
    await recordAgentQuoteMonetization({
      intent,
      dashboard: container.persistence.dashboard,
      auditLogger: container.auditLogger,
      actor: principal.actor,
      requestId: request.id,
    });
    return envelope(request, serializePaymentIntent(intent));
  });

  app.post('/payment-intents/:id/select', async (request) => {
    const principal = requireScope(request, 'payment:authorize');
    const { id } = parseOrThrow(paymentIntentIdParamsSchema, request.params, 'params');
    const body = parseOrThrow(selectPaymentRouteSchema, request.body, 'body');
    const intent = await container.agentPayments.selectRoute({
      organizationId: principal.organizationId,
      agentId: principal.kind === 'agent' ? principal.subjectId : null,
      paymentIntentId: id,
      routeId: body.routeId,
      actor: principal.actor,
      requestId: request.id,
    });
    return envelope(request, serializePaymentIntent(intent));
  });

  app.post('/payment-intents/:id/authorize', async (request) => {
    const principal = requireScope(request, 'payment:authorize');
    const { id } = parseOrThrow(paymentIntentIdParamsSchema, request.params, 'params');
    const intent = await container.agentPayments.authorizeIntent({
      organizationId: principal.organizationId,
      agentId: principal.kind === 'agent' ? principal.subjectId : null,
      paymentIntentId: id,
      actor: principal.actor,
      requestId: request.id,
    });
    return envelope(request, serializePaymentIntent(intent));
  });

  app.post('/payment-intents/:id/simulate', async (request) => {
    if (container.config.productionLocked) {
      throw new ExecutionNotImplementedError();
    }
    const principal = requireScope(request, 'payment:authorize');
    const { id } = parseOrThrow(paymentIntentIdParamsSchema, request.params, 'params');
    const intent = await container.agentPayments.simulateIntent({
      organizationId: principal.organizationId,
      agentId: principal.kind === 'agent' ? principal.subjectId : null,
      paymentIntentId: id,
      actor: principal.actor,
      requestId: request.id,
    });
    return envelope(request, serializePaymentIntent(intent));
  });
}
