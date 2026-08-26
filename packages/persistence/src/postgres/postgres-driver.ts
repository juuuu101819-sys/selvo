import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  ConfigurationError,
  IdempotencyConflictError,
  PersistenceError,
  type AuditEvent,
  type AuditEventType,
  type AuditLogRepository,
  type ComparisonRepository,
  type JsonObject,
  type PersistenceDriver,
  type StoredComparison,
} from '@meridian/core';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const DEFAULT_LIST_LIMIT = 50;
const UNIQUE_VIOLATION = '23505';

interface ComparisonRow extends QueryResultRow {
  comparison_id: string;
  created_at: Date;
  mode: string;
  engine_version: string;
  fingerprint: string;
  source_currency: string;
  target_currency: string;
  amount_minor_units: string;
  idempotency_key: string | null;
  snapshot: unknown;
  result: unknown;
}

interface AuditRow extends QueryResultRow {
  event_id: string;
  type: string;
  occurred_at: Date;
  actor: string;
  request_id: string | null;
  comparison_id: string | null;
  provider_id: string | null;
  payload: unknown;
}

export interface PostgresDriverOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
  readonly ssl?: boolean;
}

/**
 * PostgreSQL-backed persistence.
 *
 * Two deliberate choices carry through from the schema. Monetary amounts round-trip as NUMERIC
 * strings rather than JavaScript numbers, so a large minor-unit count cannot lose precision in the
 * driver. And the audit repository has no update or delete path — the immutability of the audit
 * trail is enforced both here and by a trigger in the migration.
 *
 * Apply `migrations/0001_init.sql` before pointing the API at a database; `healthCheck` fails
 * loudly if the schema is absent rather than letting the first write error out mid-request.
 */
export class PostgresPersistenceDriver implements PersistenceDriver {
  readonly kind = 'postgres';
  readonly comparisons: ComparisonRepository;
  readonly auditLog: AuditLogRepository;
  private readonly pool: Pool;

  constructor(options: PostgresDriverOptions) {
    if (options.connectionString.trim() === '') {
      throw new ConfigurationError('DATABASE_URL is required when DATABASE_DRIVER is "postgres".');
    }

    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
      statement_timeout: options.statementTimeoutMs ?? 5_000,
      ...(options.ssl === true ? { ssl: { rejectUnauthorized: true } } : {}),
    });

    this.comparisons = new PostgresComparisonRepository(this.pool);
    this.auditLog = new PostgresAuditLogRepository(this.pool);
  }

  async healthCheck(): Promise<void> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw new PersistenceError('Could not connect to PostgreSQL.', {}, { cause: error });
    }
    try {
      const result = await client.query<{ present: boolean }>(
        `SELECT (to_regclass('public.comparisons') IS NOT NULL
                 AND to_regclass('public.audit_events') IS NOT NULL) AS present`,
      );
      if (result.rows[0]?.present !== true) {
        throw new ConfigurationError(
          'The Meridian schema is missing. Apply packages/persistence/migrations/0001_init.sql.',
        );
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PostgresComparisonRepository implements ComparisonRepository {
  constructor(private readonly pool: Pool) {}

  async save(comparison: StoredComparison): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO comparisons (
           comparison_id, created_at, mode, engine_version, fingerprint,
           source_currency, target_currency, amount_minor_units, idempotency_key,
           snapshot, result
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (comparison_id) DO NOTHING`,
        [
          comparison.comparisonId,
          comparison.createdAt,
          comparison.mode,
          comparison.engineVersion,
          comparison.fingerprint,
          comparison.sourceCurrency,
          comparison.targetCurrency,
          comparison.amountMinorUnits,
          comparison.idempotencyKey,
          JSON.stringify(comparison.snapshot),
          JSON.stringify(comparison.result),
        ],
      );
    } catch (error) {
      if (
        comparison.idempotencyKey !== null &&
        isUniqueViolation(error, 'comparisons_idempotency_key_key')
      ) {
        throw new IdempotencyConflictError(comparison.idempotencyKey);
      }
      throw new PersistenceError('Failed to persist the comparison.', {}, { cause: error });
    }
  }

  async findById(comparisonId: string): Promise<StoredComparison | null> {
    const rows = await this.query(`SELECT * FROM comparisons WHERE comparison_id = $1`, [
      comparisonId,
    ]);
    const row = rows[0];
    return row === undefined ? null : toStoredComparison(row);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<StoredComparison | null> {
    const rows = await this.query(`SELECT * FROM comparisons WHERE idempotency_key = $1`, [
      idempotencyKey,
    ]);
    const row = rows[0];
    return row === undefined ? null : toStoredComparison(row);
  }

  async list(options: { limit?: number } = {}): Promise<readonly StoredComparison[]> {
    const rows = await this.query(
      `SELECT * FROM comparisons ORDER BY created_at DESC, sequence DESC LIMIT $1`,
      [options.limit ?? DEFAULT_LIST_LIMIT],
    );
    return rows.map(toStoredComparison);
  }

  private async query(sql: string, values: readonly unknown[]): Promise<ComparisonRow[]> {
    try {
      const result = await this.pool.query<ComparisonRow>(sql, [...values]);
      return result.rows;
    } catch (error) {
      throw new PersistenceError('Failed to read comparisons.', {}, { cause: error });
    }
  }
}

class PostgresAuditLogRepository implements AuditLogRepository {
  constructor(private readonly pool: Pool) {}

  async append(event: AuditEvent): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO audit_events (
           event_id, type, occurred_at, actor, request_id, comparison_id, provider_id, payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          event.eventId,
          event.type,
          event.occurredAt,
          event.actor,
          event.requestId,
          event.comparisonId,
          event.providerId,
          JSON.stringify(event.payload),
        ],
      );
    } catch (error) {
      throw new PersistenceError('Failed to append the audit event.', {}, { cause: error });
    }
  }

  async listByComparison(comparisonId: string): Promise<readonly AuditEvent[]> {
    const rows = await this.query(
      `SELECT * FROM audit_events WHERE comparison_id = $1 ORDER BY occurred_at ASC`,
      [comparisonId],
    );
    return rows.map(toAuditEvent);
  }

  async list(options: { limit?: number } = {}): Promise<readonly AuditEvent[]> {
    const rows = await this.query(`SELECT * FROM audit_events ORDER BY occurred_at DESC LIMIT $1`, [
      options.limit ?? DEFAULT_LIST_LIMIT,
    ]);
    return rows.map(toAuditEvent);
  }

  private async query(sql: string, values: readonly unknown[]): Promise<AuditRow[]> {
    try {
      const result = await this.pool.query<AuditRow>(sql, [...values]);
      return result.rows;
    } catch (error) {
      throw new PersistenceError('Failed to read the audit log.', {}, { cause: error });
    }
  }
}

export function toStoredComparison(row: ComparisonRow): StoredComparison {
  return {
    comparisonId: row.comparison_id,
    createdAt: row.created_at.toISOString(),
    mode: row.mode,
    engineVersion: row.engine_version,
    fingerprint: row.fingerprint,
    // CHAR(3) is blank-padded by PostgreSQL, so the currency code needs trimming.
    sourceCurrency: row.source_currency.trim(),
    targetCurrency: row.target_currency.trim(),
    // NUMERIC arrives as a string, which is precisely what the money model wants.
    amountMinorUnits: row.amount_minor_units,
    idempotencyKey: row.idempotency_key,
    snapshot: row.snapshot,
    result: row.result,
  };
}

export function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    eventId: row.event_id,
    type: row.type as AuditEventType,
    occurredAt: row.occurred_at.toISOString(),
    actor: row.actor,
    requestId: row.request_id,
    comparisonId: row.comparison_id,
    providerId: row.provider_id,
    payload: (row.payload ?? {}) as JsonObject,
  };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === UNIQUE_VIOLATION && candidate.constraint === constraint;
}

/** Reads the bundled migration so a deployment can apply it without shipping the repo. */
export function readInitialMigration(): string {
  let directory = import.meta.dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, 'migrations', '0001_init.sql');
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  throw new ConfigurationError('Could not locate migrations/0001_init.sql.', {
    searchedFrom: import.meta.dirname,
  });
}
