import {
  ConfigurationError,
  IdempotencyConflictError,
  PersistenceError,
  type AuditEvent,
  type AuditEventType,
  type AuditLogRepository,
  type ComparisonRepository,
  type DashboardRepository,
  type ExecutionIntentRepository,
  type IdentityStore,
  type JsonObject,
  type PersistenceDriver,
  type PlatformPricingResolver,
  type RateLimitStore,
  type OnboardingStore,
  type StoredComparison,
} from '@meridian/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaPlatformPricingResolver } from './prisma-pricing-resolver.js';
import { PrismaDashboardRepository } from './prisma-dashboard.js';
import { PrismaAgentPaymentsRepository } from './prisma-agent-payments.js';
import { PrismaExecutionIntentRepository } from './prisma-execution-intents.js';
import { PrismaIdentityStore } from './prisma-identity.js';
import { PrismaOnboardingStore } from './prisma-onboarding.js';
import { PrismaRateLimitStore } from '../rate-limit/prisma-store.js';
import { Prisma, PrismaClient } from '@prisma/client';

const DEFAULT_LIST_LIMIT = 50;
const UNIQUE_VIOLATION = 'P2002';

export interface PrismaDriverOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly ssl?: boolean;
}

/**
 * PostgreSQL persistence via Prisma.
 *
 * Prisma owns the schema and the migrations; this class owns the mapping between Prisma's row types
 * and the domain's transport types. That mapping is where precision bugs would otherwise hide, so
 * it is deliberately explicit:
 *
 *   * `Decimal(38, 0)` amounts are converted with `toFixed()`, never `toNumber()`. A minor-unit
 *     count beyond `Number.MAX_SAFE_INTEGER` is entirely realistic for a large VND or IDR notional.
 *   * `Timestamptz` values are normalised to ISO-8601 UTC strings.
 *   * `Json` columns pass through unchanged; the snapshot is opaque to this layer by design.
 *
 * Nothing above the persistence package imports Prisma, so swapping the store remains a
 * configuration change rather than a code change.
 */
export class PrismaPersistenceDriver implements PersistenceDriver {
  readonly kind = 'postgres';
  readonly comparisons: ComparisonRepository;
  readonly auditLog: AuditLogRepository;
  readonly identity: IdentityStore;
  readonly dashboard: DashboardRepository;
  readonly executionIntents: ExecutionIntentRepository;
  readonly agentPayments: PrismaAgentPaymentsRepository;
  readonly rateLimits: RateLimitStore;
  readonly onboarding: OnboardingStore;
  /** Negotiated commercial terms, read from `customer_pricing`. */
  readonly pricing: PlatformPricingResolver;
  private readonly client: PrismaClient;

  constructor(options: PrismaDriverOptions) {
    if (options.connectionString.trim() === '') {
      throw new ConfigurationError('DATABASE_URL is required when DATABASE_DRIVER is "postgres".');
    }

    // The driver adapter keeps connection pooling in `pg`, where it is configurable, rather than
    // hidden inside a query engine.
    const adapter = new PrismaPg({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
      ...(options.ssl === true ? { ssl: { rejectUnauthorized: true } } : {}),
    });

    this.client = new PrismaClient({ adapter });
    this.comparisons = new PrismaComparisonRepository(this.client);
    this.auditLog = new PrismaAuditLogRepository(this.client);
    this.identity = new PrismaIdentityStore(this.client);
    this.dashboard = new PrismaDashboardRepository(this.client);
    this.executionIntents = new PrismaExecutionIntentRepository(this.client);
    this.agentPayments = new PrismaAgentPaymentsRepository(this.client);
    this.rateLimits = new PrismaRateLimitStore(this.client);
    this.pricing = new PrismaPlatformPricingResolver(this.client);
    this.onboarding = new PrismaOnboardingStore(this.client);
  }

  /**
   * Verifies the database is reachable and the schema has been applied.
   *
   * Checking for the tables rather than just connecting means a deployment that forgot
   * `prisma migrate deploy` fails readiness immediately instead of erroring mid-request.
   */
  async healthCheck(): Promise<void> {
    try {
      const rows = await this.client.$queryRaw<{ present: boolean }[]>`
        SELECT (to_regclass('public.comparisons') IS NOT NULL
                AND to_regclass('public.audit_logs') IS NOT NULL
                AND to_regclass('public.execution_intents') IS NOT NULL
                AND to_regclass('public.payment_intents') IS NOT NULL
                AND to_regclass('public.rate_limit_buckets') IS NOT NULL
                AND to_regclass('public.organization_invites') IS NOT NULL) AS present
      `;
      if (rows[0]?.present !== true) {
        throw new ConfigurationError(
          'The Meridian schema is missing. Run "npm run db:deploy" to apply prisma/migrations.',
        );
      }
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }
      throw new PersistenceError('Could not reach PostgreSQL.', {}, { cause: error });
    }
  }

  async close(): Promise<void> {
    await this.client.$disconnect();
  }
}

class PrismaComparisonRepository implements ComparisonRepository {
  constructor(private readonly client: PrismaClient) {}

  async save(comparison: StoredComparison): Promise<void> {
    try {
      await this.client.comparison.create({
        data: {
          comparisonId: comparison.comparisonId,
          createdAt: new Date(comparison.createdAt),
          mode: comparison.mode,
          engineVersion: comparison.engineVersion,
          fingerprint: comparison.fingerprint,
          sourceCurrency: comparison.sourceCurrency,
          targetCurrency: comparison.targetCurrency,
          // A string keeps the value exact all the way into the DECIMAL column.
          amountMinorUnits: new Prisma.Decimal(comparison.amountMinorUnits),
          idempotencyKey: comparison.idempotencyKey,
          organizationId: comparison.organizationId ?? null,
          snapshot: comparison.snapshot as Prisma.InputJsonValue,
          result: comparison.result as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error, 'comparison_id')) {
        // Re-saving the same comparison is harmless; the row is already correct.
        return;
      }
      if (comparison.idempotencyKey !== null && isUniqueViolation(error, 'idempotency_key')) {
        throw new IdempotencyConflictError(comparison.idempotencyKey);
      }
      throw new PersistenceError('Failed to persist the comparison.', {}, { cause: error });
    }
  }

  async findById(comparisonId: string): Promise<StoredComparison | null> {
    const row = await this.query(() =>
      this.client.comparison.findUnique({ where: { comparisonId } }),
    );
    return row === null ? null : toStoredComparison(row);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<StoredComparison | null> {
    const row = await this.query(() =>
      this.client.comparison.findUnique({ where: { idempotencyKey } }),
    );
    return row === null ? null : toStoredComparison(row);
  }

  async list(options: { limit?: number } = {}): Promise<readonly StoredComparison[]> {
    const rows = await this.query(() =>
      this.client.comparison.findMany({
        orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
        take: options.limit ?? DEFAULT_LIST_LIMIT,
      }),
    );
    return rows.map(toStoredComparison);
  }

  async listByOrganization(
    organizationId: string | null,
    options: { limit?: number } = {},
  ): Promise<readonly StoredComparison[]> {
    const rows = await this.query(() =>
      this.client.comparison.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
        take: options.limit ?? DEFAULT_LIST_LIMIT,
      }),
    );
    return rows.map(toStoredComparison);
  }

  private async query<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    try {
      return await run();
    } catch (error) {
      throw new PersistenceError('Failed to read comparisons.', {}, { cause: error });
    }
  }
}

class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly client: PrismaClient) {}

  async append(event: AuditEvent): Promise<void> {
    try {
      await this.client.auditLog.create({
        data: {
          eventId: event.eventId,
          type: event.type,
          occurredAt: new Date(event.occurredAt),
          actor: event.actor,
          requestId: event.requestId,
          comparisonId: event.comparisonId,
          providerId: event.providerId,
          organizationId: event.organizationId ?? null,
          payload: event.payload,
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to append the audit event.', {}, { cause: error });
    }
  }

  async listByComparison(comparisonId: string): Promise<readonly AuditEvent[]> {
    const rows = await this.query(() =>
      this.client.auditLog.findMany({
        where: { comparisonId },
        orderBy: { occurredAt: 'asc' },
      }),
    );
    return rows.map(toAuditEvent);
  }

  async list(options: { limit?: number } = {}): Promise<readonly AuditEvent[]> {
    const rows = await this.query(() =>
      this.client.auditLog.findMany({
        orderBy: { occurredAt: 'desc' },
        take: options.limit ?? DEFAULT_LIST_LIMIT,
      }),
    );
    return rows.map(toAuditEvent);
  }

  async listByOrganization(
    organizationId: string,
    options: { readonly types?: readonly AuditEventType[]; readonly limit?: number } = {},
  ): Promise<readonly AuditEvent[]> {
    const rows = await this.query(() =>
      this.client.auditLog.findMany({
        where: {
          organizationId,
          ...(options.types === undefined ? {} : { type: { in: [...options.types] } }),
        },
        orderBy: { occurredAt: 'desc' },
        take: options.limit ?? DEFAULT_LIST_LIMIT,
      }),
    );
    return rows.map(toAuditEvent);
  }

  private async query<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    try {
      return await run();
    } catch (error) {
      throw new PersistenceError('Failed to read the audit log.', {}, { cause: error });
    }
  }
}

/** Shape of a `comparisons` row as Prisma returns it. Declared so the mapping is unit-testable. */
export interface ComparisonRow {
  readonly comparisonId: string;
  readonly createdAt: Date;
  readonly mode: string;
  readonly engineVersion: string;
  readonly fingerprint: string;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly amountMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly idempotencyKey: string | null;
  readonly organizationId?: string | null;
  readonly snapshot: unknown;
  readonly result: unknown;
}

export interface AuditEventRow {
  readonly eventId: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly actor: string;
  readonly requestId: string | null;
  readonly comparisonId: string | null;
  readonly providerId: string | null;
  readonly organizationId?: string | null;
  readonly payload: unknown;
}

export function toStoredComparison(row: ComparisonRow): StoredComparison {
  return {
    comparisonId: row.comparisonId,
    createdAt: row.createdAt.toISOString(),
    mode: row.mode,
    engineVersion: row.engineVersion,
    fingerprint: row.fingerprint,
    sourceCurrency: row.sourceCurrency,
    targetCurrency: row.targetCurrency,
    // `toFixed(0)` and never `toNumber()`: a large minor-unit count exceeds the safe integer range.
    amountMinorUnits: row.amountMinorUnits.toFixed(0),
    idempotencyKey: row.idempotencyKey,
    organizationId: row.organizationId ?? null,
    snapshot: row.snapshot,
    result: row.result,
  };
}

export function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    eventId: row.eventId,
    type: row.type as AuditEventType,
    occurredAt: row.occurredAt.toISOString(),
    actor: row.actor,
    requestId: row.requestId,
    comparisonId: row.comparisonId,
    providerId: row.providerId,
    organizationId: row.organizationId ?? null,
    payload: (row.payload ?? {}) as JsonObject,
  };
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
