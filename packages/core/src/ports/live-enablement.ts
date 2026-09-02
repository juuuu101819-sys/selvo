import type { LiveEnablementRecord, LiveEnablementScope } from '../domain/live-enablement.js';

export interface UpsertLiveEnablementInput {
  readonly id: string;
  readonly scope: LiveEnablementScope;
  readonly scopeKey: string;
  readonly region: string;
  readonly enabled: boolean;
  readonly signOff: LiveEnablementRecord['signOff'];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly disabledAt: string | null;
  readonly disabledReason: string | null;
}

export interface LiveEnablementStore {
  upsert(record: UpsertLiveEnablementInput): Promise<LiveEnablementRecord>;
  find(scope: LiveEnablementScope, scopeKey: string): Promise<LiveEnablementRecord | null>;
  list(): Promise<readonly LiveEnablementRecord[]>;
}
