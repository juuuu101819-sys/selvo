import {
  IdempotencyConflictError,
  PersistenceError,
  isRoutePreference,
  type Agent,
  type AgentCredential,
  type AgentPaymentsRepository,
  type AgentStatus,
  type AgentWalletReference,
  type ApiScope,
  type CreateAgentCredentialInput,
  type CreateAgentInput,
  type CreateMerchantInput,
  type CreatePaymentPolicyInput,
  type CreateWalletReferenceInput,
  type DailySpendingQuery,
  type ListCursor,
  type Merchant,
  type PaymentIntent,
  type PaymentIntentStatus,
  type PaymentPolicy,
  type PublicAgent,
  type QuotedRouteOption,
  type RoutePreference,
  type SimulatedExecutionReceipt,
} from '@meridian/core';
import { Prisma, type PrismaClient } from '@prisma/client';
import { descKeysetWhere } from './keyset.js';

const DEFAULT_LIST_LIMIT = 50;
const UNIQUE_VIOLATION = 'P2002';

export class PrismaAgentPaymentsRepository implements AgentPaymentsRepository {
  constructor(private readonly client: PrismaClient) {}

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const row = await this.write(() =>
      this.client.agent.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          name: input.name,
          status: 'active',
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.createdAt),
        },
      }),
    );
    return toAgent(row);
  }

  async findAgent(id: string, organizationId: string): Promise<Agent | null> {
    const row = await this.read(() =>
      this.client.agent.findFirst({ where: { id, organizationId } }),
    );
    return row === null ? null : toAgent(row);
  }

  async listAgents(organizationId: string): Promise<readonly PublicAgent[]> {
    const rows = await this.read(() =>
      this.client.agent.findMany({
        where: { organizationId },
        include: { credentials: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map(toPublicAgent);
  }

  async updateAgentStatus(
    id: string,
    organizationId: string,
    status: AgentStatus,
    nowIso: string,
  ): Promise<boolean> {
    const result = await this.write(() =>
      this.client.agent.updateMany({
        where: { id, organizationId },
        data: { status, updatedAt: new Date(nowIso) },
      }),
    );
    return result.count > 0;
  }

  async updateAgentExecutionAuthorization(
    id: string,
    organizationId: string,
    input: {
      readonly executionAuthorized: boolean;
      readonly executionAuthorizedAt: string | null;
      readonly executionAuthorizedByActor: string | null;
      readonly executionAgreementReference: string | null;
      readonly nowIso: string;
    },
  ): Promise<boolean> {
    const result = await this.write(() =>
      this.client.agent.updateMany({
        where: { id, organizationId },
        data: {
          executionAuthorized: input.executionAuthorized,
          executionAuthorizedAt:
            input.executionAuthorizedAt === null ? null : new Date(input.executionAuthorizedAt),
          executionAuthorizedByActor: input.executionAuthorizedByActor,
          executionAgreementReference: input.executionAgreementReference,
          updatedAt: new Date(input.nowIso),
        },
      }),
    );
    return result.count > 0;
  }

  async createCredential(input: CreateAgentCredentialInput): Promise<void> {
    await this.write(() =>
      this.client.agentCredential.create({
        data: {
          id: input.id,
          agentId: input.agentId,
          organizationId: input.organizationId,
          keyPrefix: input.keyPrefix,
          secretHash: input.secretHash,
          scopes: [...input.scopes],
          createdAt: new Date(input.createdAt),
          expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt),
        },
      }),
    );
  }

  async findCredentialByPrefix(keyPrefix: string): Promise<AgentCredential | null> {
    const row = await this.read(() =>
      this.client.agentCredential.findUnique({ where: { keyPrefix } }),
    );
    return row === null ? null : toCredential(row);
  }

  async touchCredential(id: string, nowIso: string): Promise<void> {
    await this.write(() =>
      this.client.agentCredential.update({
        where: { id },
        data: { lastUsedAt: new Date(nowIso) },
      }),
    );
  }

  async replaceCredentialSecretHash(id: string, secretHash: string): Promise<void> {
    await this.write(() =>
      this.client.agentCredential.update({
        where: { id },
        data: { secretHash },
      }),
    );
  }

  async revokeCredentialsForAgent(
    agentId: string,
    organizationId: string,
    nowIso: string,
  ): Promise<void> {
    await this.write(() =>
      this.client.agentCredential.updateMany({
        where: { agentId, organizationId, revokedAt: null },
        data: { revokedAt: new Date(nowIso) },
      }),
    );
  }

  async createWalletReference(input: CreateWalletReferenceInput): Promise<AgentWalletReference> {
    const row = await this.write(() =>
      this.client.agentWalletReference.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          agentId: input.agentId,
          kind: input.kind,
          label: input.label,
          externalRef: input.externalRef,
          controlledByPlatform: false,
          createdAt: new Date(input.createdAt),
        },
      }),
    );
    return toWallet(row);
  }

  async listWalletReferences(
    organizationId: string,
    agentId: string,
  ): Promise<readonly AgentWalletReference[]> {
    const rows = await this.read(() =>
      this.client.agentWalletReference.findMany({ where: { organizationId, agentId } }),
    );
    return rows.map(toWallet);
  }

  async createMerchant(input: CreateMerchantInput): Promise<Merchant> {
    const row = await this.write(() =>
      this.client.merchant.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          name: input.name,
          recipientCode: input.recipientCode,
          settlementAsset: input.settlementAsset,
          status: 'active',
          createdAt: new Date(input.createdAt),
        },
      }),
    );
    return toMerchant(row);
  }

  async listMerchants(organizationId: string): Promise<readonly Merchant[]> {
    const rows = await this.read(() =>
      this.client.merchant.findMany({ where: { organizationId } }),
    );
    return rows.map(toMerchant);
  }

  async findMerchant(organizationId: string, recipientCode: string): Promise<Merchant | null> {
    const row = await this.read(() =>
      this.client.merchant.findFirst({
        where: { organizationId, recipientCode: { equals: recipientCode, mode: 'insensitive' } },
      }),
    );
    return row === null ? null : toMerchant(row);
  }

  async createPolicy(input: CreatePaymentPolicyInput): Promise<PaymentPolicy> {
    const row = await this.write(() =>
      this.client.paymentPolicy.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          agentId: input.agentId,
          maxTransactionAmountMinorUnits: new Prisma.Decimal(input.maxTransactionAmountMinorUnits),
          allowedAssets: [...input.allowedAssets],
          allowedRecipientCodes: [...input.allowedRecipientCodes],
          allowedProviderIds: [...input.allowedProviderIds],
          allowedChainIds: [...input.allowedChainIds],
          allowedCountryCodes: [...input.allowedCountryCodes],
          maxFeeBps: new Prisma.Decimal(input.maxFeeBps),
          maxSlippageBps: new Prisma.Decimal(input.maxSlippageBps),
          minRouteScore: new Prisma.Decimal(input.minRouteScore),
          minLiquidityHeadroom: new Prisma.Decimal(input.minLiquidityHeadroom),
          dailySpendingLimitMinorUnits: new Prisma.Decimal(input.dailySpendingLimitMinorUnits),
          dailySpendingAsset: input.dailySpendingAsset,
          preferredRoutePreference: input.preferredRoutePreference,
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.createdAt),
        },
      }),
    );
    return toPolicy(row);
  }

  async findPolicyByAgent(organizationId: string, agentId: string): Promise<PaymentPolicy | null> {
    const row = await this.read(() =>
      this.client.paymentPolicy.findUnique({
        where: { organizationId_agentId: { organizationId, agentId } },
      }),
    );
    return row === null ? null : toPolicy(row);
  }

  async listPolicies(organizationId: string): Promise<readonly PaymentPolicy[]> {
    const rows = await this.read(() =>
      this.client.paymentPolicy.findMany({ where: { organizationId } }),
    );
    return rows.map(toPolicy);
  }

  async updatePolicy(policy: PaymentPolicy): Promise<PaymentPolicy> {
    const row = await this.write(() =>
      this.client.paymentPolicy.update({
        where: { organizationId_agentId: { organizationId: policy.organizationId, agentId: policy.agentId } },
        data: {
          maxTransactionAmountMinorUnits: new Prisma.Decimal(policy.maxTransactionAmountMinorUnits),
          allowedAssets: [...policy.allowedAssets],
          allowedRecipientCodes: [...policy.allowedRecipientCodes],
          allowedProviderIds: [...policy.allowedProviderIds],
          allowedChainIds: [...policy.allowedChainIds],
          allowedCountryCodes: [...policy.allowedCountryCodes],
          maxFeeBps: new Prisma.Decimal(policy.maxFeeBps),
          maxSlippageBps: new Prisma.Decimal(policy.maxSlippageBps),
          minRouteScore: new Prisma.Decimal(policy.minRouteScore),
          minLiquidityHeadroom: new Prisma.Decimal(policy.minLiquidityHeadroom),
          dailySpendingLimitMinorUnits: new Prisma.Decimal(policy.dailySpendingLimitMinorUnits),
          dailySpendingAsset: policy.dailySpendingAsset,
          preferredRoutePreference: policy.preferredRoutePreference,
          updatedAt: new Date(policy.updatedAt),
        },
      }),
    );
    return toPolicy(row);
  }

  async createIntent(intent: PaymentIntent): Promise<PaymentIntent> {
    try {
      const row = await this.client.paymentIntent.create({ data: toIntentData(intent) });
      return toIntent(row);
    } catch (error) {
      if (intent.idempotencyKey !== null && isUniqueViolation(error, 'idempotency_key')) {
        throw new IdempotencyConflictError(intent.idempotencyKey);
      }
      throw new PersistenceError('Failed to persist the payment intent.', {}, { cause: error });
    }
  }

  async updateIntent(intent: PaymentIntent): Promise<PaymentIntent> {
    const { id: _id, ...data } = toIntentData(intent);
    const row = await this.write(() =>
      this.client.paymentIntent.update({
        where: { id: intent.id },
        data,
      }),
    );
    return toIntent(row);
  }

  async findIntentById(id: string, organizationId: string): Promise<PaymentIntent | null> {
    const row = await this.read(() =>
      this.client.paymentIntent.findFirst({ where: { id, organizationId } }),
    );
    return row === null ? null : toIntent(row);
  }

  async findIntentByIdempotencyKey(
    organizationId: string,
    agentId: string,
    idempotencyKey: string,
  ): Promise<PaymentIntent | null> {
    const row = await this.read(() =>
      this.client.paymentIntent.findFirst({
        where: { organizationId, agentId, idempotencyKey },
      }),
    );
    return row === null ? null : toIntent(row);
  }

  async listIntents(
    organizationId: string,
    options: { readonly agentId?: string; readonly limit?: number; readonly after?: ListCursor } = {},
  ): Promise<readonly PaymentIntent[]> {
    const rows = await this.read(() =>
      this.client.paymentIntent.findMany({
        where: {
          organizationId,
          ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
          ...descKeysetWhere(options.after, 'createdAt', 'id'),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: options.limit ?? DEFAULT_LIST_LIMIT,
      }),
    );
    return rows.map(toIntent);
  }

  async sumDailySpending(query: DailySpendingQuery): Promise<string> {
    const result = await this.read(() =>
      this.client.paymentIntent.aggregate({
        where: {
          organizationId: query.organizationId,
          agentId: query.agentId,
          sourceAsset: query.asset,
          status: { in: [...query.statuses] },
          ...(query.excludeIntentId === undefined ? {} : { id: { not: query.excludeIntentId } }),
          OR: [
            {
              authorizedAt: {
                gte: new Date(query.fromInclusive),
                lt: new Date(query.toExclusive),
              },
            },
            {
              authorizedAt: null,
              createdAt: {
                gte: new Date(query.fromInclusive),
                lt: new Date(query.toExclusive),
              },
            },
          ],
        },
        _sum: { amountMinorUnits: true },
      }),
    );
    return result._sum.amountMinorUnits?.toFixed(0) ?? '0';
  }

  async withExclusiveAgentAccess<T>(
    organizationId: string,
    agentId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM payment_policies
        WHERE organization_id = ${organizationId} AND agent_id = ${agentId}
        FOR UPDATE
      `;
      return run();
    });
  }

  private async read<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    try {
      return await run();
    } catch (error) {
      throw new PersistenceError('Failed to read agent payment records.', {}, { cause: error });
    }
  }

  private async write<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    try {
      return await run();
    } catch (error) {
      throw new PersistenceError('Failed to write agent payment records.', {}, { cause: error });
    }
  }
}

function toIntentData(intent: PaymentIntent): Prisma.PaymentIntentUncheckedCreateInput {
  return {
    id: intent.id,
    organizationId: intent.organizationId,
    agentId: intent.agentId,
    sourceAsset: intent.sourceAsset,
    destinationAsset: intent.destinationAsset,
    amountMinorUnits: new Prisma.Decimal(intent.amountMinorUnits),
    recipient: intent.recipient,
    purpose: intent.purpose,
    routePreference: intent.routePreference,
    maxFeeBps: intent.maxFeeBps === null ? null : new Prisma.Decimal(intent.maxFeeBps),
    expiresAt: new Date(intent.expiresAt),
    status: intent.status,
    idempotencyKey: intent.idempotencyKey,
    payloadFingerprint: intent.payloadFingerprint,
    quotedRoutes: intent.quotedRoutes as unknown as Prisma.InputJsonValue,
    quoteExpiresAt: intent.quoteExpiresAt === null ? null : new Date(intent.quoteExpiresAt),
    selectedRouteId: intent.selectedRouteId,
    authorizedAt: intent.authorizedAt === null ? null : new Date(intent.authorizedAt),
    simulatedAt: intent.simulatedAt === null ? null : new Date(intent.simulatedAt),
    simulation:
      intent.simulation === null
        ? Prisma.JsonNull
        : (intent.simulation as unknown as Prisma.InputJsonValue),
    failureReason: intent.failureReason,
    fundsMoved: false,
    custody: false,
    realExecution: false,
    actor: intent.actor,
    createdAt: new Date(intent.createdAt),
    updatedAt: new Date(intent.updatedAt),
  };
}

interface AgentRow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly executionAuthorized: boolean;
  readonly executionAuthorizedAt: Date | null;
  readonly executionAuthorizedByActor: string | null;
  readonly executionAgreementReference: string | null;
}

interface CredentialRow {
  readonly id: string;
  readonly agentId: string;
  readonly organizationId: string;
  readonly keyPrefix: string;
  readonly secretHash: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
}

interface WalletRow {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly kind: string;
  readonly label: string;
  readonly externalRef: string;
  readonly createdAt: Date;
}

interface MerchantRow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly recipientCode: string;
  readonly settlementAsset: string;
  readonly status: string;
  readonly createdAt: Date;
}

interface PolicyRow {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly maxTransactionAmountMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly allowedAssets: readonly string[];
  readonly allowedRecipientCodes: readonly string[];
  readonly allowedProviderIds: readonly string[];
  readonly allowedChainIds: readonly string[];
  readonly allowedCountryCodes: readonly string[];
  readonly maxFeeBps: { toFixed(decimalPlaces?: number): string };
  readonly maxSlippageBps: { toFixed(decimalPlaces?: number): string };
  readonly minRouteScore: { toFixed(decimalPlaces?: number): string };
  readonly minLiquidityHeadroom: { toFixed(decimalPlaces?: number): string };
  readonly dailySpendingLimitMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly dailySpendingAsset: string;
  readonly preferredRoutePreference: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface IntentRow {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly recipient: string;
  readonly purpose: string;
  readonly routePreference: string | null;
  readonly maxFeeBps: { toFixed(decimalPlaces?: number): string } | null;
  readonly expiresAt: Date;
  readonly status: string;
  readonly idempotencyKey: string | null;
  readonly payloadFingerprint: string;
  readonly quotedRoutes: unknown;
  readonly quoteExpiresAt: Date | null;
  readonly selectedRouteId: string | null;
  readonly authorizedAt: Date | null;
  readonly simulatedAt: Date | null;
  readonly simulation: unknown;
  readonly failureReason: string | null;
  readonly actor: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    status: row.status as AgentStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    executionAuthorized: row.executionAuthorized,
    executionAuthorizedAt: row.executionAuthorizedAt?.toISOString() ?? null,
    executionAuthorizedByActor: row.executionAuthorizedByActor,
    executionAgreementReference: row.executionAgreementReference,
  };
}

function toPublicAgent(row: AgentRow & { credentials: CredentialRow[] }): PublicAgent {
  const credential = row.credentials[0];
  return {
    ...toAgent(row),
    keyPrefix: credential?.keyPrefix ?? null,
    scopes: credential === undefined ? [] : credential.scopes.filter(isScope),
    credentialExpiresAt: credential?.expiresAt?.toISOString() ?? null,
    credentialRevokedAt: credential?.revokedAt?.toISOString() ?? null,
  };
}

function toCredential(row: CredentialRow): AgentCredential {
  return {
    id: row.id,
    agentId: row.agentId,
    organizationId: row.organizationId,
    keyPrefix: row.keyPrefix,
    secretHash: row.secretHash,
    scopes: row.scopes.filter(isScope),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toWallet(row: WalletRow): AgentWalletReference {
  return {
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    kind: row.kind === 'external_wallet' ? 'external_wallet' : 'external_account',
    label: row.label,
    externalRef: row.externalRef,
    controlledByPlatform: false,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMerchant(row: MerchantRow): Merchant {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    recipientCode: row.recipientCode,
    settlementAsset: row.settlementAsset,
    status: row.status as AgentStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPolicy(row: PolicyRow): PaymentPolicy {
  return {
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    maxTransactionAmountMinorUnits: row.maxTransactionAmountMinorUnits.toFixed(0),
    allowedAssets: [...row.allowedAssets],
    allowedRecipientCodes: [...row.allowedRecipientCodes],
    allowedProviderIds: [...row.allowedProviderIds],
    allowedChainIds: [...row.allowedChainIds],
    allowedCountryCodes: [...row.allowedCountryCodes],
    maxFeeBps: row.maxFeeBps.toFixed(),
    maxSlippageBps: row.maxSlippageBps.toFixed(),
    minRouteScore: row.minRouteScore.toFixed(),
    minLiquidityHeadroom: row.minLiquidityHeadroom.toFixed(),
    dailySpendingLimitMinorUnits: row.dailySpendingLimitMinorUnits.toFixed(0),
    dailySpendingAsset: row.dailySpendingAsset,
    preferredRoutePreference: isRoutePreference(row.preferredRoutePreference)
      ? row.preferredRoutePreference
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toIntent(row: IntentRow): PaymentIntent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    sourceAsset: row.sourceAsset,
    destinationAsset: row.destinationAsset,
    amountMinorUnits: row.amountMinorUnits.toFixed(0),
    recipient: row.recipient,
    purpose: row.purpose,
    routePreference: (row.routePreference as RoutePreference | null) ?? null,
    maxFeeBps: row.maxFeeBps === null ? null : row.maxFeeBps.toFixed(),
    expiresAt: row.expiresAt.toISOString(),
    status: row.status as PaymentIntentStatus,
    idempotencyKey: row.idempotencyKey,
    payloadFingerprint: row.payloadFingerprint,
    quotedRoutes: Array.isArray(row.quotedRoutes)
      ? (row.quotedRoutes as QuotedRouteOption[])
      : [],
    quoteExpiresAt: row.quoteExpiresAt?.toISOString() ?? null,
    selectedRouteId: row.selectedRouteId,
    authorizedAt: row.authorizedAt?.toISOString() ?? null,
    simulatedAt: row.simulatedAt?.toISOString() ?? null,
    simulation: isSimulation(row.simulation) ? row.simulation : null,
    failureReason: row.failureReason,
    fundsMoved: false,
    custody: false,
    realExecution: false,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isScope(value: string): value is ApiScope {
  return (
    value === 'quote:read' ||
    value === 'route:read' ||
    value === 'transaction:create' ||
    value === 'payment:create' ||
    value === 'payment:quote' ||
    value === 'payment:authorize'
  );
}

function isSimulation(value: unknown): value is SimulatedExecutionReceipt {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<SimulatedExecutionReceipt>;
  return (
    candidate.simulated === true &&
    candidate.fundsMoved === false &&
    candidate.custody === false &&
    candidate.realExecution === false &&
    typeof candidate.simulationId === 'string' &&
    typeof candidate.providerId === 'string' &&
    typeof candidate.occurredAt === 'string' &&
    typeof candidate.receipt === 'string'
  );
}

function isUniqueViolation(error: unknown, column: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== UNIQUE_VIOLATION) {
    return false;
  }
  const target = candidate.meta?.target;
  if (Array.isArray(target)) {
    return target.some((entry) => typeof entry === 'string' && entry.includes(column));
  }
  return typeof target === 'string' ? target.includes(column) : false;
}
