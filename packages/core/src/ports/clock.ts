/**
 * Time source. Injected everywhere rather than read from the global clock so that quote
 * timestamps, snapshots and fingerprints are controllable in tests and a comparison is
 * reproducible.
 */
export interface Clock {
  /** Current instant as an ISO-8601 UTC string with millisecond precision. */
  nowIso(): string;
  /** Current instant in epoch milliseconds. */
  nowMs(): number;
}

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
  nowMs: () => Date.now(),
};

/** Deterministic clock for tests. Advances only when told to. */
export class FixedClock implements Clock {
  private current: number;

  constructor(start: string | number = '2026-01-01T00:00:00.000Z') {
    this.current = typeof start === 'number' ? start : new Date(start).getTime();
  }

  nowIso(): string {
    return new Date(this.current).toISOString();
  }

  nowMs(): number {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}
