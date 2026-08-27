import { PolicyDeniedError } from '../errors/index.js';
import { Dec } from '../money/index.js';
import type { PaymentPolicy, PolicyRule, QuotedRouteOption } from './agent-payments.js';

export interface PolicyEvaluationInput {
  readonly amountMinorUnits: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly recipientCode: string;
  readonly maxFeeBps: string | null;
  readonly selectedProviderId: string | null;
  readonly selectedRouteCostBps: string | null;
  readonly selectedRoute: QuotedRouteOption | null;
  readonly dailySpentMinorUnits: string;
}

export interface PolicyDecision {
  readonly allowed: true;
  readonly aiUsed: false;
  readonly failClosed: true;
}

/**
 * Deterministic non-custodial payment-policy engine.
 *
 * It never holds funds. `aiUsed` is always false: no model decides whether a payment may proceed.
 * Unknown or missing route metrics fail closed.
 */
export function evaluatePaymentPolicy(
  policy: PaymentPolicy,
  input: PolicyEvaluationInput,
): PolicyDecision {
  assertMaxTransaction(policy, input);
  assertAllowedAssets(policy, input);
  assertAllowedRecipient(policy, input);
  assertDailySpending(policy, input);
  assertMaximumFee(policy, input);
  assertAllowedProvider(policy, input);
  if (input.selectedRoute !== null) {
    assertRoutePolicy(policy, input.maxFeeBps, input.selectedRoute);
  }
  return { allowed: true, aiUsed: false, failClosed: true };
}

export function feeCapBps(policy: PaymentPolicy, intentMaxFeeBps: string | null): string {
  if (intentMaxFeeBps === null) {
    return policy.maxFeeBps;
  }
  const intent = new Dec(intentMaxFeeBps);
  const policyCap = new Dec(policy.maxFeeBps);
  return intent.lessThan(policyCap) ? intent.toFixed() : policyCap.toFixed();
}

export function filterRoutesByPolicy(
  policy: PaymentPolicy,
  intentMaxFeeBps: string | null,
  routes: readonly QuotedRouteOption[],
): readonly QuotedRouteOption[] {
  return routes.filter((route) => routeAllowedByPolicy(policy, intentMaxFeeBps, route) === null);
}

/** `null` when the route is allowed; otherwise the fail-closed rule that rejects it. */
export function routeAllowedByPolicy(
  policy: PaymentPolicy,
  intentMaxFeeBps: string | null,
  route: QuotedRouteOption,
): PolicyRule | null {
  try {
    assertRoutePolicy(policy, intentMaxFeeBps, route);
    return null;
  } catch (error) {
    if (error instanceof PolicyDeniedError) {
      const rule = error.details['rule'];
      return typeof rule === 'string' ? (rule as PolicyRule) : 'route_policy';
    }
    throw error;
  }
}

function deny(rule: PolicyRule, message: string, details: Record<string, unknown>): never {
  throw new PolicyDeniedError(rule, message, { failClosed: true, ...details });
}

function assertMaxTransaction(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  if (BigInt(input.amountMinorUnits) > BigInt(policy.maxTransactionAmountMinorUnits)) {
    deny(
      'maximum_transaction_amount',
      'Amount exceeds the agent policy maximum transaction amount.',
      {
        amountMinorUnits: input.amountMinorUnits,
        maxTransactionAmountMinorUnits: policy.maxTransactionAmountMinorUnits,
        asset: input.sourceAsset,
      },
    );
  }
}

function assertAllowedAssets(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  if (policy.allowedAssets.length === 0) {
    deny('allowed_assets', 'This agent policy allows no assets.', {
      sourceAsset: input.sourceAsset,
      destinationAsset: input.destinationAsset,
      allowedAssets: [],
    });
  }
  const allowed = new Set(policy.allowedAssets.map((asset) => asset.toUpperCase()));
  if (!allowed.has(input.sourceAsset.toUpperCase())) {
    deny('allowed_assets', `Source asset "${input.sourceAsset}" is not allowed by policy.`, {
      sourceAsset: input.sourceAsset,
      allowedAssets: [...policy.allowedAssets],
    });
  }
  if (!allowed.has(input.destinationAsset.toUpperCase())) {
    deny(
      'allowed_assets',
      `Destination asset "${input.destinationAsset}" is not allowed by policy.`,
      {
        destinationAsset: input.destinationAsset,
        allowedAssets: [...policy.allowedAssets],
      },
    );
  }
}

function assertAllowedRecipient(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  if (policy.allowedRecipientCodes.length === 0) {
    deny('allowed_recipients', 'This agent policy allows no recipients.', {
      recipient: input.recipientCode,
      allowedRecipientCodes: [],
    });
  }
  const allowed = policy.allowedRecipientCodes.map((code) => code.toLowerCase());
  if (!allowed.includes(input.recipientCode.toLowerCase())) {
    deny('allowed_recipients', `Recipient "${input.recipientCode}" is not allowed by policy.`, {
      recipient: input.recipientCode,
      allowedRecipientCodes: [...policy.allowedRecipientCodes],
    });
  }
}

function assertDailySpending(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  if (input.sourceAsset.toUpperCase() !== policy.dailySpendingAsset.toUpperCase()) {
    return;
  }
  const next = BigInt(input.dailySpentMinorUnits) + BigInt(input.amountMinorUnits);
  if (next > BigInt(policy.dailySpendingLimitMinorUnits)) {
    deny('daily_spending_limit', 'Amount would exceed the agent daily transaction limit.', {
      dailySpentMinorUnits: input.dailySpentMinorUnits,
      amountMinorUnits: input.amountMinorUnits,
      dailySpendingLimitMinorUnits: policy.dailySpendingLimitMinorUnits,
      dailySpendingAsset: policy.dailySpendingAsset,
    });
  }
}

function assertMaximumFee(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  const cap = new Dec(feeCapBps(policy, input.maxFeeBps));
  const costBps = input.selectedRoute?.totalCostBps ?? input.selectedRouteCostBps;
  if (costBps === null) {
    return;
  }
  if (new Dec(costBps).greaterThan(cap)) {
    deny('maximum_fee', 'Selected route fee exceeds the policy or intent maximum fee.', {
      selectedRouteCostBps: costBps,
      maxFeeBps: cap.toFixed(),
    });
  }
}

function assertAllowedProvider(policy: PaymentPolicy, input: PolicyEvaluationInput): void {
  const providerId = input.selectedRoute?.providerId ?? input.selectedProviderId;
  if (providerId === null) {
    return;
  }
  if (policy.allowedProviderIds.length === 0) {
    deny('allowed_providers', 'This agent policy allows no providers.', {
      providerId,
      allowedProviderIds: [],
    });
  }
  if (!policy.allowedProviderIds.includes(providerId)) {
    deny('allowed_providers', `Provider "${providerId}" is not allowed by policy.`, {
      providerId,
      allowedProviderIds: [...policy.allowedProviderIds],
    });
  }
}

function assertRoutePolicy(
  policy: PaymentPolicy,
  intentMaxFeeBps: string | null,
  route: QuotedRouteOption,
): void {
  if (policy.allowedProviderIds.length === 0) {
    deny('allowed_providers', 'This agent policy allows no providers.', {
      providerId: route.providerId,
      allowedProviderIds: [],
    });
  }
  if (!policy.allowedProviderIds.includes(route.providerId)) {
    deny('allowed_providers', `Provider "${route.providerId}" is not allowed by policy.`, {
      providerId: route.providerId,
      allowedProviderIds: [...policy.allowedProviderIds],
    });
  }

  const cap = new Dec(feeCapBps(policy, intentMaxFeeBps));
  if (new Dec(route.totalCostBps).greaterThan(cap)) {
    deny('maximum_fee', 'Selected route fee exceeds the policy or intent maximum fee.', {
      selectedRouteCostBps: route.totalCostBps,
      maxFeeBps: cap.toFixed(),
      routeId: route.routeId,
    });
  }

  if (route.chainId !== null) {
    if (policy.allowedChainIds.length === 0) {
      deny('allowed_chains', 'This agent policy allows no on-chain settlement.', {
        chainId: route.chainId,
        allowedChainIds: [],
        routeId: route.routeId,
      });
    }
    if (
      !policy.allowedChainIds.includes('*') &&
      !policy.allowedChainIds.includes(route.chainId)
    ) {
      deny('allowed_chains', `Chain "${route.chainId}" is not allowed by policy.`, {
        chainId: route.chainId,
        allowedChainIds: [...policy.allowedChainIds],
        routeId: route.routeId,
      });
    }
  }

  if (!countriesAllowed(policy.allowedCountryCodes, route.jurisdictions)) {
    deny('allowed_countries', 'Route jurisdiction is not allowed by policy.', {
      jurisdictions: [...route.jurisdictions],
      allowedCountryCodes: [...policy.allowedCountryCodes],
      routeId: route.routeId,
    });
  }

  if (route.routeScore === null) {
    deny('minimum_route_score', 'Route score is unknown; policy fails closed.', {
      routeId: route.routeId,
      minRouteScore: policy.minRouteScore,
    });
  } else if (new Dec(route.routeScore).lessThan(new Dec(policy.minRouteScore))) {
    deny('minimum_route_score', 'Selected route score is below the policy minimum.', {
      routeScore: route.routeScore,
      minRouteScore: policy.minRouteScore,
      routeId: route.routeId,
    });
  }

  const minLiquidity = new Dec(policy.minLiquidityHeadroom);
  if (minLiquidity.greaterThan(new Dec(0))) {
    if (route.liquidityHeadroom === null) {
      deny('minimum_liquidity', 'Route liquidity is unknown; policy fails closed.', {
        routeId: route.routeId,
        minLiquidityHeadroom: policy.minLiquidityHeadroom,
      });
    } else if (new Dec(route.liquidityHeadroom).lessThan(minLiquidity)) {
      deny('minimum_liquidity', 'Selected route liquidity is below the policy minimum.', {
        liquidityHeadroom: route.liquidityHeadroom,
        minLiquidityHeadroom: policy.minLiquidityHeadroom,
        routeId: route.routeId,
      });
    }
  }

  if (route.slippageBps === null) {
    deny('maximum_slippage', 'Route slippage is unknown; policy fails closed.', {
      routeId: route.routeId,
      maxSlippageBps: policy.maxSlippageBps,
    });
  } else if (new Dec(route.slippageBps).greaterThan(new Dec(policy.maxSlippageBps))) {
    deny('maximum_slippage', 'Selected route slippage exceeds the policy maximum.', {
      slippageBps: route.slippageBps,
      maxSlippageBps: policy.maxSlippageBps,
      routeId: route.routeId,
    });
  }
}

function countriesAllowed(
  allowed: readonly string[],
  jurisdictions: readonly string[],
): boolean {
  if (allowed.length === 0) {
    return false;
  }
  if (allowed.includes('*')) {
    return true;
  }
  if (jurisdictions.length === 0) {
    return false;
  }
  if (jurisdictions.includes('*')) {
    return true;
  }
  const allowedSet = new Set(allowed.map((code) => code.toUpperCase()));
  return jurisdictions.some((code) => allowedSet.has(code.toUpperCase()));
}
