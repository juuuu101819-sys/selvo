import {
  assertCorridorMayGoLive,
  assertRegionAllowedForScope,
  BILLING_LIVE_SCOPE_KEY,
  parseLegalSignOff,
  type LiveEnablementRecord,
  type LiveEnablementScope,
} from '../domain/live-enablement.js';
import { ValidationError } from '../errors/index.js';
import type { LiveEnablementStore } from '../ports/live-enablement.js';

export interface LiveEnablementServiceDependencies {
  readonly store: LiveEnablementStore;
}

export interface EnableLiveScopeCommand {
  readonly scope: LiveEnablementScope;
  readonly scopeKey: string;
  readonly region: string;
  readonly signOff: unknown;
  readonly nowIso: string;
  readonly id: string;
}

export interface DisableLiveScopeCommand {
  readonly scope: LiveEnablementScope;
  readonly scopeKey: string;
  readonly reason: string;
  readonly nowIso: string;
}

/**
 * Records per-corridor / per-partner / billing live flags.
 *
 * Enablement always requires {@link parseLegalSignOff}. There is no bypass. Enabling a row does
 * not move funds; `evaluateLiveFundsMovement` still fail-closes without adapters and process flags.
 * See `GO_LIVE_CHECKLIST.md`.
 */
export class LiveEnablementService {
  constructor(private readonly deps: LiveEnablementServiceDependencies) {}

  async enable(command: EnableLiveScopeCommand): Promise<LiveEnablementRecord> {
    const scope = command.scope;
    let scopeKey = command.scopeKey.trim();
    if (scope === 'corridor') {
      scopeKey = assertCorridorMayGoLive(scopeKey);
    } else if (scope === 'billing') {
      if (scopeKey !== BILLING_LIVE_SCOPE_KEY) {
        throw new ValidationError('Billing live enablement scopeKey must be "platform".', {
          scopeKey,
        });
      }
    } else if (scopeKey === '') {
      throw new ValidationError('Partner id is required.', { field: 'scopeKey' });
    }

    const region = assertRegionAllowedForScope(scope, scopeKey, command.region);
    const signOff = parseLegalSignOff(command.signOff, {
      scope,
      scopeKey,
      nowIso: command.nowIso,
    });

    const existing = await this.deps.store.find(scope, scopeKey);
    return this.deps.store.upsert({
      id: existing?.id ?? command.id,
      scope,
      scopeKey,
      region,
      enabled: true,
      signOff,
      createdAt: existing?.createdAt ?? command.nowIso,
      updatedAt: command.nowIso,
      disabledAt: null,
      disabledReason: null,
    });
  }

  async disable(command: DisableLiveScopeCommand): Promise<LiveEnablementRecord> {
    const existing = await this.deps.store.find(command.scope, command.scopeKey);
    if (existing === null) {
      throw new ValidationError('No live-enablement record to disable.', {
        scope: command.scope,
        scopeKey: command.scopeKey,
      });
    }
    const reason = command.reason.trim();
    if (reason === '') {
      throw new ValidationError('Disable reason is required.', { field: 'reason' });
    }
    return this.deps.store.upsert({
      ...existing,
      enabled: false,
      updatedAt: command.nowIso,
      disabledAt: command.nowIso,
      disabledReason: reason,
    });
  }

  list(): Promise<readonly LiveEnablementRecord[]> {
    return this.deps.store.list();
  }

  find(scope: LiveEnablementScope, scopeKey: string): Promise<LiveEnablementRecord | null> {
    return this.deps.store.find(scope, scopeKey);
  }
}
