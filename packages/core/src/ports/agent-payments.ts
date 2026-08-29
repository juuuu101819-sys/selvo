import type { ApiScope } from '../domain/api-scope.js';
import type {
  Agent,
  AgentCredential,
  AgentStatus,
  AgentWalletReference,
  Merchant,
  PaymentIntent,
  PaymentIntentStatus,
  PaymentPolicy,
  PublicAgent,
  RoutePreference,
} from '../domain/agent-payments.js';
import type { ListCursor } from '../pagination/cursor.js';

export interface CreateAgentInput {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface CreateAgentCredentialInput {
  readonly id: string;
  readonly agentId: string;
  readonly organizationId: string;
  readonly keyPrefix: string;
  readonly secretHash: string;
  readonly scopes: readonly ApiScope[];
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

export interface CreateWalletReferenceInput {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly kind: AgentWalletReference['kind'];
  readonly label: string;
  readonly externalRef: string;
  readonly createdAt: string;
}

export interface CreateMerchantInput {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly recipientCode: string;
  readonly settlementAsset: string;
  readonly createdAt: string;
}

export interface CreatePaymentPolicyInput {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly maxTransactionAmountMinorUnits: string;
  readonly allowedAssets: readonly string[];
  readonly allowedRecipientCodes: readonly string[];
  readonly allowedProviderIds: readonly string[];
  readonly allowedChainIds: readonly string[];
  readonly allowedCountryCodes: readonly string[];
  readonly maxFeeBps: string;
  readonly maxSlippageBps: string;
  readonly minRouteScore: string;
  readonly minLiquidityHeadroom: string;
  readonly dailySpendingLimitMinorUnits: string;
  readonly dailySpendingAsset: string;
  readonly preferredRoutePreference: RoutePreference | null;
  readonly createdAt: string;
}

export interface DailySpendingQuery {
  readonly organizationId: string;
  readonly agentId: string;
  readonly asset: string;
  readonly fromInclusive: string;
  readonly toExclusive: string;
  readonly statuses: readonly PaymentIntentStatus[];
  /** When set, this intent is omitted from the sum so a reserved row is not double-counted. */
  readonly excludeIntentId?: string;
}

/**
 * Persistence for AI-agent payment infrastructure.
 *
 * Implementations must never persist a wallet private key, seed, balance or RPC endpoint, and must
 * never return a credential secret on a public DTO.
 */
export interface AgentPaymentsRepository {
  createAgent(input: CreateAgentInput): Promise<Agent>;
  findAgent(id: string, organizationId: string): Promise<Agent | null>;
  listAgents(organizationId: string): Promise<readonly PublicAgent[]>;
  updateAgentStatus(
    id: string,
    organizationId: string,
    status: AgentStatus,
    nowIso: string,
  ): Promise<boolean>;
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
  ): Promise<boolean>;

  createCredential(input: CreateAgentCredentialInput): Promise<void>;
  findCredentialByPrefix(keyPrefix: string): Promise<AgentCredential | null>;
  touchCredential(id: string, nowIso: string): Promise<void>;
  /** Replaces an agent-credential secret hash in place (legacy SHA-256 → scrypt). */
  replaceCredentialSecretHash(id: string, secretHash: string): Promise<void>;
  revokeCredentialsForAgent(agentId: string, organizationId: string, nowIso: string): Promise<void>;

  createWalletReference(input: CreateWalletReferenceInput): Promise<AgentWalletReference>;
  listWalletReferences(
    organizationId: string,
    agentId: string,
  ): Promise<readonly AgentWalletReference[]>;

  createMerchant(input: CreateMerchantInput): Promise<Merchant>;
  listMerchants(organizationId: string): Promise<readonly Merchant[]>;
  findMerchant(organizationId: string, recipientCode: string): Promise<Merchant | null>;

  createPolicy(input: CreatePaymentPolicyInput): Promise<PaymentPolicy>;
  findPolicyByAgent(organizationId: string, agentId: string): Promise<PaymentPolicy | null>;
  listPolicies(organizationId: string): Promise<readonly PaymentPolicy[]>;
  updatePolicy(policy: PaymentPolicy): Promise<PaymentPolicy>;

  createIntent(intent: PaymentIntent): Promise<PaymentIntent>;
  updateIntent(intent: PaymentIntent): Promise<PaymentIntent>;
  findIntentById(id: string, organizationId: string): Promise<PaymentIntent | null>;
  findIntentByIdempotencyKey(
    organizationId: string,
    agentId: string,
    idempotencyKey: string,
  ): Promise<PaymentIntent | null>;
  listIntents(
    organizationId: string,
    options?: { readonly agentId?: string; readonly limit?: number; readonly after?: ListCursor },
  ): Promise<readonly PaymentIntent[]>;
  sumDailySpending(query: DailySpendingQuery): Promise<string>;
  /**
   * Serializes work that checks and reserves daily spend for one agent.
   *
   * Memory uses an in-process mutex. Postgres locks the agent's policy row. Callers must perform
   * the remaining-capacity check and the status transition inside `run`.
   */
  withExclusiveAgentAccess<T>(
    organizationId: string,
    agentId: string,
    run: () => Promise<T>,
  ): Promise<T>;
}
