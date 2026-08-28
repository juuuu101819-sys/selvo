import type {
  PaymentIntent,
  PaymentPolicy,
  PublicAgent,
  QuotedRouteOption,
} from '../domain/agent-payments.js';
import type {
  AgentDashboardDetail,
  AgentDashboardSummary,
  AgentPolicyViolation,
  AgentSpendingSnapshot,
  PreferredRouteRow,
} from '../domain/agent-dashboard.js';
import { assetExponent } from '../domain/asset.js';
import { CURRENCY_REGISTRY, Dec, isCurrencyCode, toDecimal } from '../money/index.js';

/**
 * AI-agent financial dashboard aggregator.
 *
 * Volume, average fee and success rate use Decimal/`bigint` only. Counts are integer. This is a
 * projection of quoted and simulated intents — it never implies funds moved.
 */
export function summarizeAgentDashboard(input: {
  readonly agent: PublicAgent;
  readonly intents: readonly PaymentIntent[];
  readonly policy: PaymentPolicy | null;
  readonly dailySpentMinorUnits: string;
  readonly violations: readonly AgentPolicyViolation[];
}): AgentDashboardSummary {
  const scoped = input.intents.filter(
    (intent) =>
      intent.agentId === input.agent.id && intent.organizationId === input.agent.organizationId,
  );
  const reporting = reportingAsset(scoped, input.policy);
  const comparable = scoped.filter((intent) => intent.sourceAsset === reporting.asset);
  const completed = scoped.filter((intent) => intent.status === 'SIMULATION_COMPLETED');
  const failed = scoped.filter((intent) => intent.status === 'FAILED');
  const quoted = scoped.filter((intent) => intent.quotedRoutes.length > 0);
  const preferred = preferredRoutesOf(scoped);
  const dailyLimit = input.policy?.dailySpendingLimitMinorUnits ?? null;

  return {
    agentId: input.agent.id,
    name: input.agent.name,
    status: input.agent.status,
    createdAt: input.agent.createdAt,
    transactionCount: scoped.length,
    completedCount: completed.length,
    failedCount: failed.length,
    quotedCount: quoted.length,
    policyViolationCount: input.violations.length,
    paymentVolumeMinorUnits: sumMinor(comparable.map((intent) => intent.amountMinorUnits)),
    currency: reporting.asset,
    exponent: reporting.exponent,
    averageFeeBps: averageFeeBps(scoped),
    routeSuccessRatePercent: successRatePercent(completed.length, failed.length),
    preferredRoute: preferred[0] ?? null,
    dailySpentMinorUnits: parseNonNegative(input.dailySpentMinorUnits).toString(),
    dailyLimitMinorUnits: dailyLimit,
    fundsMoved: false,
    custody: false,
  };
}

export function buildAgentDashboardDetail(input: {
  readonly agent: PublicAgent;
  readonly intents: readonly PaymentIntent[];
  readonly policy: PaymentPolicy | null;
  readonly dailySpentMinorUnits: string;
  readonly violations: readonly AgentPolicyViolation[];
}): AgentDashboardDetail {
  const summary = summarizeAgentDashboard(input);
  return {
    summary,
    spending: spendingOf(input.policy, input.dailySpentMinorUnits),
    preferredRoutes: preferredRoutesOf(
      input.intents.filter(
        (intent) =>
          intent.agentId === input.agent.id && intent.organizationId === input.agent.organizationId,
      ),
    ),
    violations: [...input.violations].sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt),
    ),
    fundsMoved: false,
    custody: false,
    walletsGenerated: false,
    privateKeysHeld: false,
  };
}

export function violationFromAuditPayload(input: {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly payload: {
    readonly agentId?: unknown;
    readonly organizationId?: unknown;
    readonly rule?: unknown;
    readonly message?: unknown;
    readonly paymentIntentId?: unknown;
  };
  readonly organizationId: string;
  readonly agentId: string;
}): AgentPolicyViolation | null {
  if (input.payload.agentId !== input.agentId) {
    return null;
  }
  if (
    input.payload.organizationId !== undefined &&
    input.payload.organizationId !== input.organizationId
  ) {
    return null;
  }
  const rule = typeof input.payload.rule === 'string' ? input.payload.rule : 'route_policy';
  const message =
    typeof input.payload.message === 'string' ? input.payload.message : 'Policy denied.';
  const paymentIntentId =
    typeof input.payload.paymentIntentId === 'string' ? input.payload.paymentIntentId : null;
  return {
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    agentId: input.agentId,
    rule,
    message,
    paymentIntentId,
  };
}

function spendingOf(
  policy: PaymentPolicy | null,
  dailySpentMinorUnits: string,
): AgentSpendingSnapshot | null {
  if (policy === null) {
    return null;
  }
  const spent = parseNonNegative(dailySpentMinorUnits);
  const limit = parseNonNegative(policy.dailySpendingLimitMinorUnits);
  const remaining = limit > spent ? limit - spent : 0n;
  return {
    asset: policy.dailySpendingAsset,
    exponent: exponentOf(policy.dailySpendingAsset),
    dailyLimitMinorUnits: limit.toString(),
    dailySpentMinorUnits: spent.toString(),
    dailyRemainingMinorUnits: remaining.toString(),
    maxTransactionMinorUnits: parseNonNegative(policy.maxTransactionAmountMinorUnits).toString(),
    preferredRoutePreference: policy.preferredRoutePreference,
  };
}

function preferredRoutesOf(intents: readonly PaymentIntent[]): readonly PreferredRouteRow[] {
  const groups = new Map<string, PreferredRouteRow>();
  for (const intent of intents) {
    const route = selectedOrRecommended(intent);
    if (route === null) {
      continue;
    }
    const key = `${route.providerId}:${route.rail}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        providerId: route.providerId,
        providerName: route.providerName,
        rail: route.rail,
        intentCount: 1,
      });
    } else {
      groups.set(key, { ...existing, intentCount: existing.intentCount + 1 });
    }
  }
  return [...groups.values()].sort((left, right) => {
    if (right.intentCount !== left.intentCount) {
      return right.intentCount - left.intentCount;
    }
    return left.providerId.localeCompare(right.providerId);
  });
}

function selectedOrRecommended(intent: PaymentIntent): QuotedRouteOption | null {
  if (intent.selectedRouteId !== null) {
    const selected = intent.quotedRoutes.find((route) => route.routeId === intent.selectedRouteId);
    if (selected !== undefined) {
      return selected;
    }
  }
  return intent.quotedRoutes.find((route) => route.recommended) ?? intent.quotedRoutes[0] ?? null;
}

function averageFeeBps(intents: readonly PaymentIntent[]): string | null {
  const fees: string[] = [];
  for (const intent of intents) {
    const route = selectedOrRecommended(intent);
    if (route === null) {
      continue;
    }
    fees.push(route.totalCostBps);
  }
  if (fees.length === 0) {
    return null;
  }
  let sum = new Dec(0);
  for (const fee of fees) {
    sum = sum.plus(toDecimal(fee));
  }
  return sum.div(toDecimal(String(fees.length))).toFixed(4);
}

function successRatePercent(completed: number, failed: number): string | null {
  const denom = completed + failed;
  if (denom === 0) {
    return null;
  }
  return toDecimal(String(completed))
    .div(toDecimal(String(denom)))
    .times(100)
    .toFixed(1);
}

function reportingAsset(
  intents: readonly PaymentIntent[],
  policy: PaymentPolicy | null,
): { readonly asset: string; readonly exponent: number } {
  if (policy !== null) {
    return { asset: policy.dailySpendingAsset, exponent: exponentOf(policy.dailySpendingAsset) };
  }
  const counts = new Map<string, number>();
  for (const intent of intents) {
    counts.set(intent.sourceAsset, (counts.get(intent.sourceAsset) ?? 0) + 1);
  }
  let best = 'USD';
  let bestCount = -1;
  for (const [asset, count] of counts) {
    if (count > bestCount || (count === bestCount && asset < best)) {
      best = asset;
      bestCount = count;
    }
  }
  return { asset: best, exponent: exponentOf(best) };
}

function exponentOf(asset: string): number {
  if (isCurrencyCode(asset)) {
    return CURRENCY_REGISTRY[asset].exponent;
  }
  return assetExponent(asset);
}

function sumMinor(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    total += parseNonNegative(value);
  }
  return total.toString();
}

function parseNonNegative(raw: string): bigint {
  if (!/^\d+$/.test(raw.trim())) {
    return 0n;
  }
  return BigInt(raw.trim());
}
