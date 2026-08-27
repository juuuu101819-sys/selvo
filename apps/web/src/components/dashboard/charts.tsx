import type { ReactNode } from 'react';
import type { CostPointDto, DashboardProviderUsageDto, VolumePointDto } from '@/lib/api/types';
import { exponentFor } from '@/lib/currency';
import { formatBps, formatQuotedAmount } from '@/lib/format';

function barWidth(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return Math.max((value / max) * 100, 2);
}

export function DashboardCharts({
  volumeByDay,
  costByDay,
  providers,
}: {
  volumeByDay: readonly VolumePointDto[];
  costByDay: readonly CostPointDto[];
  providers: readonly DashboardProviderUsageDto[];
}) {
  const maxVolume = Math.max(
    0,
    ...volumeByDay.map((point) => Number(point.minorUnits) / 10 ** exponentFor(point.currency)),
  );
  const maxCost = Math.max(0, ...costByDay.map((point) => Number(point.averageCostBps)));
  const maxQuotes = Math.max(0, ...providers.map((provider) => provider.quoteCount));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Quoted volume by day"
        description="Transaction request notional in the last 30 days, taken from stored requests."
        empty={volumeByDay.length === 0}
      >
        <ul className="space-y-3">
          {volumeByDay.map((point) => {
            const major = Number(point.minorUnits) / 10 ** exponentFor(point.currency);
            return (
              <li key={`${point.date}-${point.currency}`}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-mono text-xs">
                    {point.date} · {point.currency}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    {formatQuotedAmount(
                      point.minorUnits,
                      point.currency,
                      exponentFor(point.currency),
                    )}
                  </span>
                </div>
                <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{ width: `${barWidth(major, maxVolume)}%` }}
                    role="presentation"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </ChartCard>

      <ChartCard
        title="Average recommended cost"
        description="Mean all-in cost of the recommended quote each day, in basis points."
        empty={costByDay.length === 0}
      >
        <ul className="space-y-3">
          {costByDay.map((point) => (
            <li key={point.date}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-mono text-xs">{point.date}</span>
                <span className="font-mono text-xs tabular-nums">
                  {formatBps(point.averageCostBps)} · {point.quoteCount} quotes
                </span>
              </div>
              <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-foreground/40"
                  style={{ width: `${barWidth(Number(point.averageCostBps), maxCost)}%` }}
                  role="presentation"
                />
              </div>
            </li>
          ))}
        </ul>
      </ChartCard>

      <ChartCard
        title="Quotes by provider"
        description="How often each rail was priced for this organization."
        empty={providers.length === 0}
        className="lg:col-span-2"
      >
        <ul className="space-y-3">
          {providers.map((provider) => (
            <li key={provider.providerId}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {provider.providerName}
                  <span className="text-muted-foreground ml-2 font-mono text-xs">
                    {provider.rail}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums">
                  {provider.quoteCount} quotes · {provider.recommendedCount} recommended
                </span>
              </div>
              <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-emerald-600"
                  style={{ width: `${barWidth(provider.quoteCount, maxQuotes)}%` }}
                  role="presentation"
                />
              </div>
            </li>
          ))}
        </ul>
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  description,
  empty,
  className,
  children,
}: {
  title: string;
  description: string;
  empty: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`border-border rounded-xl border p-4 sm:p-5 ${className ?? ''}`}
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
      {empty ? (
        <p className="text-muted-foreground mt-4 text-sm">
          No stored rows in this window. Charts are built from database data only — they stay empty
          until this organization has quotes.
        </p>
      ) : (
        <div className="mt-4">{children}</div>
      )}
    </section>
  );
}
