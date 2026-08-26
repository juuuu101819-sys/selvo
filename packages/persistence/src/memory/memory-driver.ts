import {
  IdempotencyConflictError,
  type AuditEvent,
  type AuditLogRepository,
  type ComparisonRepository,
  type PersistenceDriver,
  type StoredComparison,
} from '@meridian/core';

const DEFAULT_LIST_LIMIT = 50;

/**
 * Non-durable in-process store.
 *
 * The default driver for local development and the entire test suite, so tests exercise the real
 * repository contract without needing a database. Values are structurally cloned on the way in and
 * out, which means a caller mutating a returned object cannot corrupt stored state — a property
 * the PostgreSQL driver gets for free and this one has to be explicit about.
 */
export class InMemoryComparisonRepository implements ComparisonRepository {
  private readonly byId = new Map<string, StoredComparison>();
  private readonly byIdempotencyKey = new Map<string, string>();
  /**
   * Insertion order, used to break ties on `createdAt`.
   *
   * Two comparisons can share a timestamp — the clock has millisecond resolution and a fixed clock
   * in tests has none at all — so ordering on the timestamp alone leaves "most recent first"
   * undefined. The PostgreSQL driver breaks the same tie with a BIGSERIAL column.
   */
  private readonly sequenceById = new Map<string, number>();
  private sequence = 0;

  save(comparison: StoredComparison): Promise<void> {
    const { idempotencyKey } = comparison;
    if (idempotencyKey !== null) {
      const existing = this.byIdempotencyKey.get(idempotencyKey);
      if (existing !== undefined && existing !== comparison.comparisonId) {
        return Promise.reject(new IdempotencyConflictError(idempotencyKey));
      }
      this.byIdempotencyKey.set(idempotencyKey, comparison.comparisonId);
    }
    if (!this.sequenceById.has(comparison.comparisonId)) {
      this.sequence += 1;
      this.sequenceById.set(comparison.comparisonId, this.sequence);
    }
    this.byId.set(comparison.comparisonId, structuredClone(comparison));
    return Promise.resolve();
  }

  findById(comparisonId: string): Promise<StoredComparison | null> {
    const found = this.byId.get(comparisonId);
    return Promise.resolve(found === undefined ? null : structuredClone(found));
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<StoredComparison | null> {
    const comparisonId = this.byIdempotencyKey.get(idempotencyKey);
    return comparisonId === undefined ? Promise.resolve(null) : this.findById(comparisonId);
  }

  list(options: { limit?: number } = {}): Promise<readonly StoredComparison[]> {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    const ordered = [...this.byId.values()]
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          (this.sequenceById.get(right.comparisonId) ?? 0) -
            (this.sequenceById.get(left.comparisonId) ?? 0),
      )
      .slice(0, limit);
    return Promise.resolve(ordered.map((item) => structuredClone(item)));
  }

  get size(): number {
    return this.byId.size;
  }
}

/** Append-only in-memory audit log. Exposes no mutation of an already-written event. */
export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly events: AuditEvent[] = [];

  append(event: AuditEvent): Promise<void> {
    this.events.push(structuredClone(event));
    return Promise.resolve();
  }

  listByComparison(comparisonId: string): Promise<readonly AuditEvent[]> {
    return Promise.resolve(
      this.events
        .filter((event) => event.comparisonId === comparisonId)
        .map((event) => structuredClone(event)),
    );
  }

  list(options: { limit?: number } = {}): Promise<readonly AuditEvent[]> {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    return Promise.resolve(
      [...this.events]
        .reverse()
        .slice(0, limit)
        .map((event) => structuredClone(event)),
    );
  }

  get size(): number {
    return this.events.length;
  }
}

export class InMemoryPersistenceDriver implements PersistenceDriver {
  readonly kind = 'memory';
  readonly comparisons = new InMemoryComparisonRepository();
  readonly auditLog = new InMemoryAuditLogRepository();

  healthCheck(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
