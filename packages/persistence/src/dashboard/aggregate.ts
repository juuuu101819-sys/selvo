import {
  CURRENCY_REGISTRY,
  isCurrencyCode,
  type DashboardMetrics,
  type DashboardQuote,
  type DashboardTransaction,
  type VolumePoint,
  type CostPoint,
  type DashboardProviderUsage,
  type VolumeByCurrency,
  type SavingsByCurrency,
} from '@meridian/core';

function exponentOf(currency: string): number {
  return isCurrencyCode(currency) ? CURRENCY_REGISTRY[currency].exponent : 0;
}

function addMinor(left: string, right: string): string {
  return (BigInt(left) + BigInt(right)).toString();
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Dashboard figures, computed from already-scoped rows.
 *
 * Callers must pass only one organization's quotes and transactions. This function does not
 * re-check tenant identity; the repository is the place that filter belongs.
 */
export function aggregateMetrics(
  quotes: readonly DashboardQuote[],
  transactions: readonly DashboardTransaction[],
): DashboardMetrics {
  const volumeByCurrency = new Map<string, { minorUnits: string; requestCount: number }>();
  for (const request of transactions) {
    const current = volumeByCurrency.get(request.sourceCurrency) ?? {
      minorUnits: '0',
      requestCount: 0,
    };
    volumeByCurrency.set(request.sourceCurrency, {
      minorUnits: addMinor(current.minorUnits, request.amountMinorUnits),
      requestCount: current.requestCount + 1,
    });
  }

  const totalQuotedVolume: VolumeByCurrency[] = [...volumeByCurrency.entries()].map(
    ([currency, value]) => ({
      currency,
      exponent: exponentOf(currency),
      minorUnits: value.minorUnits,
      requestCount: value.requestCount,
    }),
  );

  const quotesByRequest = new Map<string, DashboardQuote[]>();
  for (const quote of quotes) {
    const list = quotesByRequest.get(quote.transactionRequestId) ?? [];
    list.push(quote);
    quotesByRequest.set(quote.transactionRequestId, list);
  }

  const savingsByCurrency = new Map<string, string>();
  for (const group of quotesByRequest.values()) {
    const recommended = group.find((quote) => quote.isRecommended) ?? group[0];
    if (recommended === undefined) {
      continue;
    }
    let maxCost = 0n;
    for (const quote of group) {
      const cost = BigInt(quote.totalCostMinorUnits);
      if (cost > maxCost) {
        maxCost = cost;
      }
    }
    const saved = maxCost - BigInt(recommended.totalCostMinorUnits);
    if (saved <= 0n) {
      continue;
    }
    const currency = recommended.targetCurrency;
    savingsByCurrency.set(
      currency,
      addMinor(savingsByCurrency.get(currency) ?? '0', saved.toString()),
    );
  }

  const estimatedSavings: SavingsByCurrency[] = [...savingsByCurrency.entries()].map(
    ([currency, minorUnits]) => ({
      currency,
      exponent: exponentOf(currency),
      minorUnits,
    }),
  );

  const recommended = quotes.filter((quote) => quote.isRecommended);
  const costValues = recommended.map((quote) => Number(quote.totalCostBps));
  const settlementValues = recommended.map((quote) => quote.settlementP50Seconds);
  const averageCost = mean(costValues.filter((value) => Number.isFinite(value)));
  const averageSettlement = mean(settlementValues);

  const successful = transactions.filter(
    (request) => request.status === 'quoted' || request.status === 'quote_selected',
  ).length;

  return {
    totalQuotedVolume,
    estimatedSavings,
    quoteCount: quotes.length,
    successfulRouteRequests: successful,
    averageRouteCostBps: averageCost === null ? null : averageCost.toFixed(4),
    averageSettlementP50Seconds: averageSettlement === null ? null : Math.round(averageSettlement),
  };
}

export function aggregateVolumeByDay(
  transactions: readonly DashboardTransaction[],
  days: number,
  nowMs: number,
): readonly VolumePoint[] {
  const cutoff = nowMs - days * 86_400_000;
  const buckets = new Map<string, { minorUnits: string; requestCount: number }>();
  for (const request of transactions) {
    const created = Date.parse(request.createdAt);
    if (!Number.isFinite(created) || created < cutoff) {
      continue;
    }
    const date = request.createdAt.slice(0, 10);
    const key = `${date}|${request.sourceCurrency}`;
    const current = buckets.get(key) ?? { minorUnits: '0', requestCount: 0 };
    buckets.set(key, {
      minorUnits: addMinor(current.minorUnits, request.amountMinorUnits),
      requestCount: current.requestCount + 1,
    });
  }
  return [...buckets.entries()]
    .map(([key, value]) => {
      const [date, currency] = key.split('|');
      return {
        date: date ?? '',
        currency: currency ?? '',
        minorUnits: value.minorUnits,
        requestCount: value.requestCount,
      };
    })
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) || left.currency.localeCompare(right.currency),
    );
}

export function aggregateCostByDay(
  quotes: readonly DashboardQuote[],
  days: number,
  nowMs: number,
): readonly CostPoint[] {
  const cutoff = nowMs - days * 86_400_000;
  const buckets = new Map<string, number[]>();
  for (const quote of quotes) {
    if (!quote.isRecommended) {
      continue;
    }
    const quoted = Date.parse(quote.quotedAt);
    if (!Number.isFinite(quoted) || quoted < cutoff) {
      continue;
    }
    const date = quote.quotedAt.slice(0, 10);
    const list = buckets.get(date) ?? [];
    list.push(Number(quote.totalCostBps));
    buckets.set(date, list);
  }
  return [...buckets.entries()]
    .map(([date, values]) => ({
      date,
      averageCostBps: (mean(values) ?? 0).toFixed(4),
      quoteCount: values.length,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function aggregateProviderUsage(
  quotes: readonly DashboardQuote[],
): readonly DashboardProviderUsage[] {
  const byProvider = new Map<string, DashboardQuote[]>();
  for (const quote of quotes) {
    const list = byProvider.get(quote.providerId) ?? [];
    list.push(quote);
    byProvider.set(quote.providerId, list);
  }
  return [...byProvider.entries()]
    .map(([providerId, list]) => {
      const recommended = list.filter((quote) => quote.isRecommended);
      const costs = recommended.map((quote) => Number(quote.totalCostBps));
      const settlements = recommended.map((quote) => quote.settlementP50Seconds);
      const first = list[0];
      return {
        providerId,
        providerName: first?.providerName ?? providerId,
        rail: first?.rail ?? 'unknown',
        quoteCount: list.length,
        recommendedCount: recommended.length,
        averageCostBps: mean(costs.filter((value) => Number.isFinite(value)))?.toFixed(4) ?? null,
        averageSettlementP50Seconds:
          mean(settlements) === null ? null : Math.round(mean(settlements) ?? 0),
      };
    })
    .sort((left, right) => right.quoteCount - left.quoteCount);
}
