import {
  PersistenceError,
  isCurrencyCode,
  isRailType,
  type CurrencyCode,
  type PlatformPricingResolver,
  type PlatformPricingRule,
  type PricingRuleQuery,
  type RailType,
} from '@meridian/core';
import type { PrismaClient } from '@prisma/client';

/**
 * Reads an organization's negotiated terms from `customer_pricing`.
 *
 * Fetches every candidate for the corridor in one query and leaves the selection to the engine's
 * pure resolver. Doing the narrowing in SQL would mean one query per route and, worse, would put a
 * commercial decision somewhere it cannot be replayed from a stored snapshot.
 *
 * Rows narrowed to a currency or rail the platform no longer recognises are skipped rather than
 * coerced: an unrecognised rail in a pricing rule is a data problem, and silently widening the rule
 * to "any rail" could apply a keen negotiated term far beyond what was agreed.
 */
export class PrismaPlatformPricingResolver implements PlatformPricingResolver {
  constructor(private readonly client: PrismaClient) {}

  async rulesFor(query: PricingRuleQuery): Promise<readonly PlatformPricingRule[]> {
    const at = new Date(query.at);

    let rows;
    try {
      rows = await this.client.customerPricing.findMany({
        where: {
          organizationId: query.organizationId,
          status: 'active',
          effectiveFrom: { lte: at },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
          // A rule either targets this corridor leg or applies to any.
          AND: [
            { OR: [{ sourceCurrency: null }, { sourceCurrency: query.sourceCurrency }] },
            { OR: [{ targetCurrency: null }, { targetCurrency: query.targetCurrency }] },
          ],
        },
        orderBy: [{ priority: 'desc' }, { effectiveFrom: 'desc' }, { id: 'asc' }],
      });
    } catch (error) {
      throw new PersistenceError('Failed to read customer pricing.', {}, { cause: error });
    }

    return rows.flatMap((row) => {
      const sourceCurrency = toCurrency(row.sourceCurrency);
      const targetCurrency = toCurrency(row.targetCurrency);
      const rail = toRail(row.rail);
      if (sourceCurrency === undefined || targetCurrency === undefined || rail === undefined) {
        return [];
      }

      return [
        {
          id: row.id,
          organizationId: row.organizationId,
          sourceCurrency,
          targetCurrency,
          rail,
          providerId: row.providerId,
          // Decimal to exact string, never toNumber(): basis points carry four decimal places.
          markupBps: row.markupBps.toFixed(),
          discountBps: row.discountBps.toFixed(),
          platformFeeMinorUnits: row.platformFeeMinorUnits.toFixed(0),
          feeCurrency: toCurrency(row.feeCurrency) ?? null,
          priority: row.priority,
          effectiveFrom: row.effectiveFrom.toISOString(),
          effectiveTo: row.effectiveTo?.toISOString() ?? null,
        } satisfies PlatformPricingRule,
      ];
    });
  }
}

/** `undefined` means the stored value is unrecognised; `null` means the rule applies to any. */
function toCurrency(value: string | null): CurrencyCode | null | undefined {
  if (value === null) {
    return null;
  }
  return isCurrencyCode(value) ? value : undefined;
}

function toRail(value: string | null): RailType | null | undefined {
  if (value === null) {
    return null;
  }
  return isRailType(value) ? value : undefined;
}
