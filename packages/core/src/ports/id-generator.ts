import { randomUUID } from 'node:crypto';

/**
 * Identifier source. Injected so tests can assert on stable ids; the identifier is never derived
 * from the calculation itself (that is what the fingerprint is for).
 */
export interface IdGenerator {
  generate(prefix: string): string;
}

export const uuidIdGenerator: IdGenerator = {
  generate: (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`,
};

/** Deterministic, monotonic generator for tests. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  generate(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter.toString().padStart(8, '0')}`;
  }
}
