import type { LiveEnablementRecord, LiveEnablementStore, LiveEnablementScope } from '@meridian/core';

export class InMemoryLiveEnablementStore implements LiveEnablementStore {
  private readonly rows = new Map<string, LiveEnablementRecord>();

  private key(scope: LiveEnablementScope, scopeKey: string): string {
    return `${scope}:${scopeKey}`;
  }

  upsert(record: LiveEnablementRecord): Promise<LiveEnablementRecord> {
    const stored = structuredClone(record);
    this.rows.set(this.key(record.scope, record.scopeKey), stored);
    return Promise.resolve(structuredClone(stored));
  }

  find(scope: LiveEnablementScope, scopeKey: string): Promise<LiveEnablementRecord | null> {
    const found = this.rows.get(this.key(scope, scopeKey));
    return Promise.resolve(found === undefined ? null : structuredClone(found));
  }

  list(): Promise<readonly LiveEnablementRecord[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .sort((left, right) => {
          const scope = left.scope.localeCompare(right.scope, 'en');
          return scope !== 0 ? scope : left.scopeKey.localeCompare(right.scopeKey, 'en');
        })
        .map((row) => structuredClone(row)),
    );
  }
}
