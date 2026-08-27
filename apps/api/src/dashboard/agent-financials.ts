import {
  DAILY_SPENDING_STATUSES,
  ROUTE_PREFERENCE_VALUES,
  buildAgentDashboardDetail,
  serializeAgentDashboardDetail,
  serializeAgentDashboardSummary,
  serializeAgentPolicyViolation,
  serializeAgentSpendingSnapshot,
  serializePaymentPolicy,
  summarizeAgentDashboard,
  utcDayWindow,
  violationFromAuditPayload,
  type AgentDashboardDetailDto,
  type AgentDashboardSummaryDto,
  type AgentPaymentsRepository,
  type AgentPolicyControlsDto,
  type AgentPolicyViolation,
  type AuditLogRepository,
  type PaymentIntent,
  type PaymentPolicy,
  type PublicAgent,
} from '@meridian/core';

const POLICY_DENIED = 'payment.policy.denied' as const;
const INTENT_LIST_LIMIT = 200;
const VIOLATION_LIST_LIMIT = 200;

const CONTROL_ASSETS = ['USD', 'USDC', 'KRW'] as const;

export async function listAgentDashboardSummaries(input: {
  readonly organizationId: string;
  readonly nowIso: string;
  readonly agentPayments: AgentPaymentsRepository;
  readonly auditLog: AuditLogRepository;
}): Promise<readonly AgentDashboardSummaryDto[]> {
  const [agents, intents, policies, denials] = await Promise.all([
    input.agentPayments.listAgents(input.organizationId),
    input.agentPayments.listIntents(input.organizationId, { limit: INTENT_LIST_LIMIT }),
    input.agentPayments.listPolicies(input.organizationId),
    input.auditLog.listByOrganization(input.organizationId, {
      types: [POLICY_DENIED],
      limit: VIOLATION_LIST_LIMIT,
    }),
  ]);
  const window = utcDayWindow(input.nowIso);
  const summaries: AgentDashboardSummaryDto[] = [];
  for (const agent of agents) {
    const policy = policies.find((row) => row.agentId === agent.id) ?? null;
    const spent = await dailySpent(input.agentPayments, {
      organizationId: input.organizationId,
      agentId: agent.id,
      policy,
      window,
    });
    const violations = violationsForAgent(denials, input.organizationId, agent.id);
    summaries.push(
      serializeAgentDashboardSummary(
        summarizeAgentDashboard({
          agent,
          intents,
          policy,
          dailySpentMinorUnits: spent,
          violations,
        }),
      ),
    );
  }
  return summaries;
}

export async function loadAgentDashboardDetail(input: {
  readonly organizationId: string;
  readonly agentId: string;
  readonly nowIso: string;
  readonly agentPayments: AgentPaymentsRepository;
  readonly auditLog: AuditLogRepository;
}): Promise<AgentDashboardDetailDto | null> {
  const loaded = await loadAgentBundle(input);
  if (loaded === null) {
    return null;
  }
  return serializeAgentDashboardDetail(loaded.detail);
}

export async function loadAgentPolicyControls(input: {
  readonly organizationId: string;
  readonly agentId: string;
  readonly nowIso: string;
  readonly agentPayments: AgentPaymentsRepository;
  readonly auditLog: AuditLogRepository;
  readonly providers: readonly { readonly id: string; readonly name: string }[];
}): Promise<AgentPolicyControlsDto | null> {
  const loaded = await loadAgentBundle(input);
  if (loaded === null) {
    return null;
  }
  const merchants = await input.agentPayments.listMerchants(input.organizationId);
  const allowed = new Set(loaded.policy?.allowedProviderIds ?? []);
  const availableAssets = uniqueStrings([
    ...CONTROL_ASSETS,
    ...(loaded.policy?.allowedAssets ?? []),
  ]);
  const availableRecipients = uniqueRecipients(
    merchants.map((merchant) => ({ code: merchant.recipientCode, name: merchant.name })),
    loaded.policy?.allowedRecipientCodes ?? [],
  );
  return {
    policy: loaded.policy === null ? null : serializePaymentPolicy(loaded.policy),
    spending:
      loaded.detail.spending === null
        ? null
        : serializeAgentSpendingSnapshot(loaded.detail.spending),
    violations: loaded.violations.map(serializeAgentPolicyViolation),
    availableAssets,
    availableProviders: uniqueProviders(input.providers, allowed),
    availableRecipients,
    routePreferences: [...ROUTE_PREFERENCE_VALUES],
    fundsMoved: false,
    custody: false,
    walletsGenerated: false,
    privateKeysHeld: false,
  };
}

export async function loadAgentPaymentHistory(input: {
  readonly organizationId: string;
  readonly agentId: string;
  readonly agentPayments: AgentPaymentsRepository;
}): Promise<readonly PaymentIntent[] | null> {
  const agent = await input.agentPayments.findAgent(input.agentId, input.organizationId);
  if (agent === null) {
    return null;
  }
  return input.agentPayments.listIntents(input.organizationId, {
    agentId: input.agentId,
    limit: INTENT_LIST_LIMIT,
  });
}

async function loadAgentBundle(input: {
  readonly organizationId: string;
  readonly agentId: string;
  readonly nowIso: string;
  readonly agentPayments: AgentPaymentsRepository;
  readonly auditLog: AuditLogRepository;
}): Promise<{
  readonly agent: PublicAgent;
  readonly intents: readonly PaymentIntent[];
  readonly policy: PaymentPolicy | null;
  readonly dailySpentMinorUnits: string;
  readonly violations: readonly AgentPolicyViolation[];
  readonly detail: ReturnType<typeof buildAgentDashboardDetail>;
} | null> {
  const listed = await input.agentPayments.listAgents(input.organizationId);
  const agent = listed.find((row) => row.id === input.agentId);
  if (agent === undefined) {
    return null;
  }
  const [intents, policy, denials] = await Promise.all([
    input.agentPayments.listIntents(input.organizationId, {
      agentId: input.agentId,
      limit: INTENT_LIST_LIMIT,
    }),
    input.agentPayments.findPolicyByAgent(input.organizationId, input.agentId),
    input.auditLog.listByOrganization(input.organizationId, {
      types: [POLICY_DENIED],
      limit: VIOLATION_LIST_LIMIT,
    }),
  ]);
  const spent = await dailySpent(input.agentPayments, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    policy,
    window: utcDayWindow(input.nowIso),
  });
  const violations = violationsForAgent(denials, input.organizationId, input.agentId);
  return {
    agent,
    intents,
    policy,
    dailySpentMinorUnits: spent,
    violations,
    detail: buildAgentDashboardDetail({
      agent,
      intents,
      policy,
      dailySpentMinorUnits: spent,
      violations,
    }),
  };
}

async function dailySpent(
  store: AgentPaymentsRepository,
  input: {
    readonly organizationId: string;
    readonly agentId: string;
    readonly policy: PaymentPolicy | null;
    readonly window: { readonly start: string; readonly end: string };
  },
): Promise<string> {
  if (input.policy === null) {
    return '0';
  }
  return store.sumDailySpending({
    organizationId: input.organizationId,
    agentId: input.agentId,
    asset: input.policy.dailySpendingAsset,
    fromInclusive: input.window.start,
    toExclusive: input.window.end,
    statuses: DAILY_SPENDING_STATUSES,
  });
}

function violationsForAgent(
  events: ReadonlyArray<{
    readonly eventId: string;
    readonly occurredAt: string;
    readonly payload: {
      readonly agentId?: unknown;
      readonly organizationId?: unknown;
      readonly rule?: unknown;
      readonly message?: unknown;
      readonly paymentIntentId?: unknown;
    };
  }>,
  organizationId: string,
  agentId: string,
): readonly AgentPolicyViolation[] {
  const rows: AgentPolicyViolation[] = [];
  for (const event of events) {
    const mapped = violationFromAuditPayload({
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      payload: event.payload,
      organizationId,
      agentId,
    });
    if (mapped !== null) {
      rows.push(mapped);
    }
  }
  return rows;
}

function uniqueProviders(
  providers: readonly { readonly id: string; readonly name: string }[],
  allowed: ReadonlySet<string>,
): readonly { readonly id: string; readonly name: string }[] {
  const byId = new Map<string, { readonly id: string; readonly name: string }>();
  for (const provider of providers) {
    byId.set(provider.id, { id: provider.id, name: provider.name });
  }
  for (const id of allowed) {
    if (!byId.has(id)) {
      byId.set(id, { id, name: id });
    }
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueRecipients(
  merchants: readonly { readonly code: string; readonly name: string }[],
  allowedCodes: readonly string[],
): readonly { readonly code: string; readonly name: string }[] {
  const byCode = new Map<string, { readonly code: string; readonly name: string }>();
  for (const merchant of merchants) {
    byCode.set(merchant.code, merchant);
  }
  for (const code of allowedCodes) {
    if (!byCode.has(code)) {
      byCode.set(code, { code, name: code });
    }
  }
  return [...byCode.values()].sort((left, right) => left.name.localeCompare(right.name));
}
