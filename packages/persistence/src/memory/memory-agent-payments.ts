import {
  IdempotencyConflictError,
  takeKeysetPage,
  DEFAULT_EXECUTION_AUTHORIZATION,
  type Agent,
  type AgentCredential,
  type AgentPaymentsRepository,
  type AgentStatus,
  type AgentWalletReference,
  type CreateAgentCredentialInput,
  type CreateAgentInput,
  type CreateMerchantInput,
  type CreatePaymentPolicyInput,
  type CreateWalletReferenceInput,
  type DailySpendingQuery,
  type ListCursor,
  type Merchant,
  type PaymentIntent,
  type PaymentPolicy,
  type PublicAgent,
} from '@meridian/core';

const DEFAULT_LIST_LIMIT = 50;

/**
 * In-process AI-agent payment store.
 *
 * Wallet references always persist `controlledByPlatform: false`. Credential secrets are hashes
 * only. Payment intents always persist `fundsMoved`, `custody` and `realExecution` as false.
 */
export class InMemoryAgentPaymentsRepository implements AgentPaymentsRepository {
  private readonly agents = new Map<string, Agent>();
  private readonly credentialsByPrefix = new Map<string, AgentCredential>();
  private readonly credentialsById = new Map<string, string>();
  private readonly wallets = new Map<string, AgentWalletReference>();
  private readonly merchants = new Map<string, Merchant>();
  private readonly policies = new Map<string, PaymentPolicy>();
  private readonly intents = new Map<string, PaymentIntent>();
  private readonly exclusiveTails = new Map<string, Promise<void>>();

  createAgent(input: CreateAgentInput): Promise<Agent> {
    const agent: Agent = {
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      status: 'active',
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      ...DEFAULT_EXECUTION_AUTHORIZATION,
    };
    this.agents.set(agent.id, agent);
    return Promise.resolve(structuredClone(agent));
  }

  findAgent(id: string, organizationId: string): Promise<Agent | null> {
    const agent = this.agents.get(id);
    if (agent === undefined || agent.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(agent));
  }

  listAgents(organizationId: string): Promise<readonly PublicAgent[]> {
    const agents = [...this.agents.values()]
      .filter((agent) => agent.organizationId === organizationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((agent) => this.toPublic(agent));
    return Promise.resolve(agents);
  }

  updateAgentStatus(
    id: string,
    organizationId: string,
    status: AgentStatus,
    nowIso: string,
  ): Promise<boolean> {
    const agent = this.agents.get(id);
    if (agent === undefined || agent.organizationId !== organizationId) {
      return Promise.resolve(false);
    }
    this.agents.set(id, { ...agent, status, updatedAt: nowIso });
    return Promise.resolve(true);
  }

  updateAgentExecutionAuthorization(
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
    const agent = this.agents.get(id);
    if (agent === undefined || agent.organizationId !== organizationId) {
      return Promise.resolve(false);
    }
    this.agents.set(id, {
      ...agent,
      executionAuthorized: input.executionAuthorized,
      executionAuthorizedAt: input.executionAuthorizedAt,
      executionAuthorizedByActor: input.executionAuthorizedByActor,
      executionAgreementReference: input.executionAgreementReference,
      updatedAt: input.nowIso,
    });
    return Promise.resolve(true);
  }

  createCredential(input: CreateAgentCredentialInput): Promise<void> {
    const stored: AgentCredential = {
      id: input.id,
      agentId: input.agentId,
      organizationId: input.organizationId,
      keyPrefix: input.keyPrefix,
      secretHash: input.secretHash,
      scopes: [...input.scopes],
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: input.createdAt,
    };
    this.credentialsByPrefix.set(stored.keyPrefix, stored);
    this.credentialsById.set(stored.id, stored.keyPrefix);
    return Promise.resolve();
  }

  findCredentialByPrefix(keyPrefix: string): Promise<AgentCredential | null> {
    const found = this.credentialsByPrefix.get(keyPrefix);
    return Promise.resolve(found === undefined ? null : structuredClone(found));
  }

  touchCredential(id: string, nowIso: string): Promise<void> {
    const prefix = this.credentialsById.get(id);
    if (prefix === undefined) {
      return Promise.resolve();
    }
    const current = this.credentialsByPrefix.get(prefix);
    if (current === undefined) {
      return Promise.resolve();
    }
    this.credentialsByPrefix.set(prefix, { ...current, lastUsedAt: nowIso });
    return Promise.resolve();
  }

  replaceCredentialSecretHash(id: string, secretHash: string): Promise<void> {
    const prefix = this.credentialsById.get(id);
    if (prefix === undefined) {
      return Promise.resolve();
    }
    const current = this.credentialsByPrefix.get(prefix);
    if (current === undefined) {
      return Promise.resolve();
    }
    this.credentialsByPrefix.set(prefix, { ...current, secretHash });
    return Promise.resolve();
  }

  revokeCredentialsForAgent(
    agentId: string,
    organizationId: string,
    nowIso: string,
  ): Promise<void> {
    for (const [prefix, credential] of this.credentialsByPrefix) {
      if (credential.agentId === agentId && credential.organizationId === organizationId) {
        this.credentialsByPrefix.set(prefix, { ...credential, revokedAt: nowIso });
      }
    }
    return Promise.resolve();
  }

  createWalletReference(input: CreateWalletReferenceInput): Promise<AgentWalletReference> {
    const stored: AgentWalletReference = {
      id: input.id,
      organizationId: input.organizationId,
      agentId: input.agentId,
      kind: input.kind,
      label: input.label,
      externalRef: input.externalRef,
      controlledByPlatform: false,
      createdAt: input.createdAt,
    };
    this.wallets.set(stored.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  listWalletReferences(
    organizationId: string,
    agentId: string,
  ): Promise<readonly AgentWalletReference[]> {
    const rows = [...this.wallets.values()]
      .filter((wallet) => wallet.organizationId === organizationId && wallet.agentId === agentId)
      .map((wallet) => structuredClone({ ...wallet, controlledByPlatform: false as const }));
    return Promise.resolve(rows);
  }

  createMerchant(input: CreateMerchantInput): Promise<Merchant> {
    const stored: Merchant = {
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      recipientCode: input.recipientCode,
      settlementAsset: input.settlementAsset,
      status: 'active',
      createdAt: input.createdAt,
    };
    this.merchants.set(stored.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  listMerchants(organizationId: string): Promise<readonly Merchant[]> {
    return Promise.resolve(
      [...this.merchants.values()]
        .filter((merchant) => merchant.organizationId === organizationId)
        .map((merchant) => structuredClone(merchant)),
    );
  }

  findMerchant(organizationId: string, recipientCode: string): Promise<Merchant | null> {
    const found = [...this.merchants.values()].find(
      (merchant) =>
        merchant.organizationId === organizationId &&
        merchant.recipientCode.toLowerCase() === recipientCode.toLowerCase(),
    );
    return Promise.resolve(found === undefined ? null : structuredClone(found));
  }

  createPolicy(input: CreatePaymentPolicyInput): Promise<PaymentPolicy> {
    const stored: PaymentPolicy = {
      id: input.id,
      organizationId: input.organizationId,
      agentId: input.agentId,
      maxTransactionAmountMinorUnits: input.maxTransactionAmountMinorUnits,
      allowedAssets: [...input.allowedAssets],
      allowedRecipientCodes: [...input.allowedRecipientCodes],
      allowedProviderIds: [...input.allowedProviderIds],
      allowedChainIds: [...input.allowedChainIds],
      allowedCountryCodes: [...input.allowedCountryCodes],
      maxFeeBps: input.maxFeeBps,
      maxSlippageBps: input.maxSlippageBps,
      minRouteScore: input.minRouteScore,
      minLiquidityHeadroom: input.minLiquidityHeadroom,
      dailySpendingLimitMinorUnits: input.dailySpendingLimitMinorUnits,
      dailySpendingAsset: input.dailySpendingAsset,
      preferredRoutePreference: input.preferredRoutePreference,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.policies.set(stored.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  findPolicyByAgent(organizationId: string, agentId: string): Promise<PaymentPolicy | null> {
    const found = [...this.policies.values()].find(
      (policy) => policy.organizationId === organizationId && policy.agentId === agentId,
    );
    return Promise.resolve(found === undefined ? null : structuredClone(found));
  }

  listPolicies(organizationId: string): Promise<readonly PaymentPolicy[]> {
    return Promise.resolve(
      [...this.policies.values()]
        .filter((policy) => policy.organizationId === organizationId)
        .map((policy) => structuredClone(policy)),
    );
  }

  updatePolicy(policy: PaymentPolicy): Promise<PaymentPolicy> {
    const existing = [...this.policies.values()].find(
      (row) => row.organizationId === policy.organizationId && row.agentId === policy.agentId,
    );
    if (existing === undefined) {
      this.policies.set(policy.id, structuredClone(policy));
      return Promise.resolve(structuredClone(policy));
    }
    const stored: PaymentPolicy = {
      ...policy,
      id: existing.id,
      createdAt: existing.createdAt,
    };
    this.policies.set(existing.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  createIntent(intent: PaymentIntent): Promise<PaymentIntent> {
    if (intent.idempotencyKey !== null) {
      const existing = [...this.intents.values()].find(
        (row) =>
          row.organizationId === intent.organizationId &&
          row.agentId === intent.agentId &&
          row.idempotencyKey === intent.idempotencyKey,
      );
      if (existing !== undefined && existing.id !== intent.id) {
        return Promise.reject(new IdempotencyConflictError(intent.idempotencyKey));
      }
    }
    const stored: PaymentIntent = {
      ...intent,
      fundsMoved: false,
      custody: false,
      realExecution: false,
    };
    this.intents.set(stored.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  updateIntent(intent: PaymentIntent): Promise<PaymentIntent> {
    const stored: PaymentIntent = {
      ...intent,
      fundsMoved: false,
      custody: false,
      realExecution: false,
    };
    this.intents.set(stored.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  findIntentById(id: string, organizationId: string): Promise<PaymentIntent | null> {
    const found = this.intents.get(id);
    if (found === undefined || found.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(found));
  }

  findIntentByIdempotencyKey(
    organizationId: string,
    agentId: string,
    idempotencyKey: string,
  ): Promise<PaymentIntent | null> {
    const found = [...this.intents.values()].find(
      (intent) =>
        intent.organizationId === organizationId &&
        intent.agentId === agentId &&
        intent.idempotencyKey === idempotencyKey,
    );
    return Promise.resolve(found === undefined ? null : structuredClone(found));
  }

  listIntents(
    organizationId: string,
    options: { readonly agentId?: string; readonly limit?: number; readonly after?: ListCursor } = {},
  ): Promise<readonly PaymentIntent[]> {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    const filtered = [...this.intents.values()]
      .filter((intent) => intent.organizationId === organizationId)
      .filter((intent) => options.agentId === undefined || intent.agentId === options.agentId);
    const page = takeKeysetPage(
      filtered,
      { limit, ...(options.after === undefined ? {} : { after: options.after }) },
      (intent) => ({ sortAt: intent.createdAt, id: intent.id }),
    );
    return Promise.resolve(page.map((intent) => structuredClone(intent)));
  }

  sumDailySpending(query: DailySpendingQuery): Promise<string> {
    let total = 0n;
    for (const intent of this.intents.values()) {
      if (intent.organizationId !== query.organizationId || intent.agentId !== query.agentId) {
        continue;
      }
      if (query.excludeIntentId !== undefined && intent.id === query.excludeIntentId) {
        continue;
      }
      if (intent.sourceAsset !== query.asset) {
        continue;
      }
      if (!query.statuses.includes(intent.status)) {
        continue;
      }
      const at = intent.authorizedAt ?? intent.createdAt;
      if (at < query.fromInclusive || at >= query.toExclusive) {
        continue;
      }
      total += BigInt(intent.amountMinorUnits);
    }
    return Promise.resolve(total.toString());
  }

  async withExclusiveAgentAccess<T>(
    organizationId: string,
    agentId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const key = `${organizationId}:${agentId}`;
    const prior = this.exclusiveTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.exclusiveTails.set(
      key,
      prior.then(
        () => held,
        () => held,
      ),
    );
    await prior.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await run();
    } finally {
      release();
    }
  }

  private toPublic(agent: Agent): PublicAgent {
    const credential = [...this.credentialsByPrefix.values()].find(
      (row) => row.agentId === agent.id,
    );
    return {
      id: agent.id,
      organizationId: agent.organizationId,
      name: agent.name,
      status: agent.status,
      createdAt: agent.createdAt,
      keyPrefix: credential?.keyPrefix ?? null,
      scopes: credential === undefined ? [] : [...credential.scopes],
      credentialExpiresAt: credential?.expiresAt ?? null,
      credentialRevokedAt: credential?.revokedAt ?? null,
      executionAuthorized: agent.executionAuthorized,
      executionAuthorizedAt: agent.executionAuthorizedAt,
      executionAuthorizedByActor: agent.executionAuthorizedByActor,
      executionAgreementReference: agent.executionAgreementReference,
    };
  }
}
