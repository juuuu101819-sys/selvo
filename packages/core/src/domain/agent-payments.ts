import { createHash } from 'node:crypto';
import type { ApiScope } from './api-scope.js';
import {
  isRoutePreferenceValue,
  ROUTE_PREFERENCE_VALUES,
  weightsForOptimizationPreference,
  type RoutePreferenceValue,
} from './optimization-preference.js';

export const AGENT_STATUSES = ['active', 'suspended', 'retired'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * AI-agent payment infrastructure.
 *
 * Flow: AI Agent → Financial Router → Financial Rail → External Provider.
 *
 * The platform never custodies an agent wallet, never holds keys, and never moves funds.
 * `AgentWalletReference` is a handle to an account the agent (or its operator) controls outside
 * Meridian. Sandbox `COMPLETED` means the simulator finished — not that money moved.
 */

export const PAYMENT_INTENT_STATUSES = [
  'CREATED',
  'QUOTING',
  'QUOTED',
  'AUTHORIZED',
  'ROUTED',
  'EXECUTION_PENDING',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

export const AGENT_WALLET_KINDS = ['external_account', 'external_wallet'] as const;
export type AgentWalletKind = (typeof AGENT_WALLET_KINDS)[number];

export const ROUTE_PREFERENCES = ROUTE_PREFERENCE_VALUES;
export type RoutePreference = RoutePreferenceValue;

export const POLICY_RULES = [
  'policy_required',
  'maximum_transaction_amount',
  'daily_spending_limit',
  'allowed_assets',
  'allowed_chains',
  'allowed_providers',
  'allowed_countries',
  'allowed_recipients',
  'maximum_fee',
  'minimum_route_score',
  'minimum_liquidity',
  'maximum_slippage',
  'route_policy',
] as const;
export type PolicyRule = (typeof POLICY_RULES)[number];

/** Statuses that consume the agent's daily simulated spending capacity. */
export const DAILY_SPENDING_STATUSES: readonly PaymentIntentStatus[] = [
  'AUTHORIZED',
  'EXECUTION_PENDING',
  'COMPLETED',
];

export const AGENT_CREDENTIAL_PREFIX = 'mag_';

export function isPaymentIntentStatus(value: unknown): value is PaymentIntentStatus {
  return typeof value === 'string' && (PAYMENT_INTENT_STATUSES as readonly string[]).includes(value);
}

export function isRoutePreference(value: unknown): value is RoutePreference {
  return isRoutePreferenceValue(value);
}

export function isAgentWalletKind(value: unknown): value is AgentWalletKind {
  return typeof value === 'string' && (AGENT_WALLET_KINDS as readonly string[]).includes(value);
}

export interface Agent {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: AgentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentCredential {
  readonly id: string;
  readonly agentId: string;
  readonly organizationId: string;
  readonly keyPrefix: string;
  readonly secretHash: string;
  readonly scopes: readonly ApiScope[];
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

export interface PublicAgent {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: AgentStatus;
  readonly createdAt: string;
  readonly keyPrefix: string | null;
  readonly scopes: readonly ApiScope[];
  readonly credentialExpiresAt: string | null;
  readonly credentialRevokedAt: string | null;
}

export interface IssuedAgent {
  readonly agent: PublicAgent;
  /** Raw credential, shown once. Only a hash is stored. */
  readonly secret: string;
}

/**
 * External wallet or account the agent controls *outside* this platform.
 *
 * `controlledByPlatform` is always false. There is no private key, seed, balance or RPC field —
 * the type cannot represent custody.
 */
export interface AgentWalletReference {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly kind: AgentWalletKind;
  readonly label: string;
  /** Non-secret handle the operator already knows (IBAN hint, exchange account id, …). */
  readonly externalRef: string;
  readonly controlledByPlatform: false;
  readonly createdAt: string;
}

export interface Merchant {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly recipientCode: string;
  readonly settlementAsset: string;
  readonly status: AgentStatus;
  readonly createdAt: string;
}

export interface PaymentPolicy {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly maxTransactionAmountMinorUnits: string;
  /** Empty means none — never "all assets". At least one asset must be listed. */
  readonly allowedAssets: readonly string[];
  readonly allowedRecipientCodes: readonly string[];
  /** Empty means none — fail closed. */
  readonly allowedProviderIds: readonly string[];
  /** CAIP-2 chain ids. Empty denies on-chain routes; fiat (`chainId: null`) is still allowed. */
  readonly allowedChainIds: readonly string[];
  /** ISO 3166-1 alpha-2, or `*` for any. Empty means none — fail closed. */
  readonly allowedCountryCodes: readonly string[];
  readonly maxFeeBps: string;
  /** 0.5% is `50`. */
  readonly maxSlippageBps: string;
  /** 0–100. Missing route score fails closed. */
  readonly minRouteScore: string;
  /** Liquidity headroom as a multiple of notional. Unknown headroom fails closed when this is > 0. */
  readonly minLiquidityHeadroom: string;
  readonly dailySpendingLimitMinorUnits: string;
  readonly dailySpendingAsset: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QuotedRouteOption {
  readonly routeId: string;
  readonly rank: number;
  readonly recommended: boolean;
  readonly providerId: string;
  readonly providerName: string;
  readonly rail: string;
  readonly totalCostBps: string;
  readonly expiresAt: string | null;
  /** 0–100 composite from the routing engine. Missing → policy fails closed. */
  readonly routeScore: string | null;
  readonly slippageBps: string | null;
  /** Multiple of notional. Null means unknown — fail closed when a minimum is set. */
  readonly liquidityHeadroom: string | null;
  readonly chainId: string | null;
  readonly jurisdictions: readonly string[];
}

export interface SimulatedExecutionReceipt {
  readonly simulationId: string;
  readonly simulated: true;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly realExecution: false;
  readonly providerId: string;
  readonly occurredAt: string;
  readonly receipt: string;
}

export interface PaymentIntent {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly recipient: string;
  readonly purpose: string;
  readonly routePreference: RoutePreference | null;
  readonly maxFeeBps: string | null;
  readonly expiresAt: string;
  readonly status: PaymentIntentStatus;
  readonly idempotencyKey: string | null;
  readonly payloadFingerprint: string;
  readonly quotedRoutes: readonly QuotedRouteOption[];
  readonly quoteExpiresAt: string | null;
  readonly selectedRouteId: string | null;
  readonly authorizedAt: string | null;
  readonly simulatedAt: string | null;
  readonly simulation: SimulatedExecutionReceipt | null;
  readonly failureReason: string | null;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly realExecution: false;
  readonly actor: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaymentIntentFingerprintInput {
  readonly agentId: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly recipient: string;
  readonly purpose: string;
  readonly routePreference: RoutePreference | null;
  readonly maxFeeBps: string | null;
  /** Client-supplied expiry only. Server-generated TTLs are excluded so replays match. */
  readonly expiresAt: string | null;
}

export function paymentIntentFingerprint(input: PaymentIntentFingerprintInput): string {
  return createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex');
}

export function utcDayWindow(nowIso: string): { readonly start: string; readonly end: string } {
  const day = nowIso.slice(0, 10);
  const startMs = Date.parse(`${day}T00:00:00.000Z`);
  return {
    start: `${day}T00:00:00.000Z`,
    end: new Date(startMs + 86_400_000).toISOString(),
  };
}

export function weightsForRoutePreference(
  preference: RoutePreference | null,
): {
  readonly cost: string;
  readonly speed: string;
  readonly liquidity: string;
  readonly reliability: string;
  readonly settlementConfidence: string;
} | null {
  return weightsForOptimizationPreference(preference);
}
