import {
  PRICING_SHAPE_ENABLEMENT_SCOPE,
  evaluatePricingShapeAdmission,
  type PricingLegalOpinionRefs,
  type PricingShapeAdmission,
  type PricingShapeFlags,
} from '../domain/pricing-shape.js';
import type { LiveEnablementRecord, LiveEnablementScope } from '../domain/live-enablement.js';
import type { PlatformMode } from '../domain/provider.js';
import type { Clock } from '../ports/clock.js';

export interface PricingShapeRegistryOptions {
  readonly mode: PlatformMode;
  readonly flags: PricingShapeFlags;
  readonly legalOpinions: PricingLegalOpinionRefs;
  readonly clock: Clock;
}

/** Scopes this registry cares about; every other LiveEnablement row is ignored. */
const PRICING_SCOPES: readonly LiveEnablementScope[] = Object.values(
  PRICING_SHAPE_ENABLEMENT_SCOPE,
).filter((scope): scope is LiveEnablementScope => scope !== null);

/**
 * In-process view of which pricing shapes may be charged.
 *
 * Hydrated from {@link LiveEnablementStore} at process start and re-hydrated whenever an operator
 * records or disables a row, mirroring the kill-switch registry.
 *
 * Only the *contents* of the enablement rows are cached. {@link current} re-evaluates the
 * admission against the clock on every read, so an expiring legal determination closes the gate at
 * its expiry instant rather than at the next refresh. Caching the verdict instead would mean a
 * lapsed opinion kept authorizing charges for as long as the cache lived.
 */
export class PricingShapeRegistry {
  private records: Readonly<Partial<Record<LiveEnablementScope, LiveEnablementRecord>>> = {};

  constructor(private readonly options: PricingShapeRegistryOptions) {}

  hydrate(records: readonly LiveEnablementRecord[]): void {
    const next: Partial<Record<LiveEnablementScope, LiveEnablementRecord>> = {};
    for (const record of records) {
      if (PRICING_SCOPES.includes(record.scope)) {
        next[record.scope] = record;
      }
    }
    this.records = next;
  }

  current(): PricingShapeAdmission {
    return evaluatePricingShapeAdmission({
      mode: this.options.mode,
      flags: this.options.flags,
      legalOpinions: this.options.legalOpinions,
      enablementRecords: this.records,
      nowIso: this.options.clock.nowIso(),
    });
  }

  isActive(shape: Parameters<PricingShapeAdmission['isActive']>[0]): boolean {
    return this.current().isActive(shape);
  }
}
