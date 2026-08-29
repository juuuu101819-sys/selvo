import type { AuditEvent, AuditEventType } from './audit.js';
import type { DashboardRepository } from './dashboard.js';
import type { ListCursor } from '../pagination/cursor.js';
import type { ExecutionIntentRepository } from './execution-intent.js';
import type { AgentPaymentsRepository } from './agent-payments.js';
import type { IdentityStore } from './identity.js';
import type { OnboardingStore } from './onboarding.js';
import type { RateLimitStore } from './rate-limit.js';
import type { BillingStore } from './billing.js';
import type { RoutingEvaluationRepository } from './routing-evaluation.js';

/**
 * A persisted comparison. The stored form is the serialised DTO plus the snapshot needed for
 * replay, so a repository never needs to understand domain classes.
 */
export interface StoredComparison<TResult = unknown, TSnapshot = unknown> {
  readonly comparisonId: string;
  readonly createdAt: string;
  readonly mode: string;
  readonly engineVersion: string;
  readonly fingerprint: string;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly amountMinorUnits: string;
  readonly idempotencyKey: string | null;
  /** Tenant that owns this comparison. Null for an unauthenticated public comparison. */
  readonly organizationId?: string | null;
  readonly snapshot: TSnapshot;
  readonly result: TResult;
}

export interface ComparisonRepository {
  save(comparison: StoredComparison): Promise<void>;
  findById(comparisonId: string): Promise<StoredComparison | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<StoredComparison | null>;
  /** Most recent first. Used by the history view. */
  list(options?: { readonly limit?: number; readonly after?: ListCursor }): Promise<readonly StoredComparison[]>;
  /**
   * Comparisons belonging to one tenant. Pass `null` for unauthenticated public comparisons.
   * Implementations filter in the query; they must not load every row and drop the rest.
   */
  listByOrganization(
    organizationId: string | null,
    options?: { readonly limit?: number; readonly after?: ListCursor },
  ): Promise<readonly StoredComparison[]>;
}

/** Append-only. No update or delete, by design. */
export interface AuditLogRepository {
  append(event: AuditEvent): Promise<void>;
  listByComparison(comparisonId: string): Promise<readonly AuditEvent[]>;
  list(options?: { readonly limit?: number }): Promise<readonly AuditEvent[]>;
  listByOrganization(
    organizationId: string,
    options?: { readonly types?: readonly AuditEventType[]; readonly limit?: number },
  ): Promise<readonly AuditEvent[]>;
}

/** Lifecycle contract shared by every persistence driver. */
export interface PersistenceDriver {
  readonly kind: string;
  readonly comparisons: ComparisonRepository;
  readonly auditLog: AuditLogRepository;
  readonly identity: IdentityStore;
  readonly dashboard: DashboardRepository;
  readonly executionIntents: ExecutionIntentRepository;
  readonly agentPayments: AgentPaymentsRepository;
  readonly rateLimits: RateLimitStore;
  readonly onboarding: OnboardingStore;
  readonly billing: BillingStore;
  readonly routingEvaluations: RoutingEvaluationRepository;
  /** Verifies the store is reachable and the schema is present. */
  healthCheck(): Promise<void>;
  close(): Promise<void>;
}
