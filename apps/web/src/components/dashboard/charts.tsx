import type { ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { CostPointDto, DashboardProviderUsageDto, VolumePointDto } from '@/lib/api/types';
import {
  displayBarPercent,
  displayBarPercentFromDecimal,
  maxDecimal,
  maxMinorUnits,
} from '@/lib/chart-display';
import { exponentFor } from '@/lib/currency';
import { formatBps, formatQuotedAmount } from '@/lib/format';

function barWidth(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return Math.max((value / max) * 100, 2);
}

export async function DashboardCharts({
  volumeByDay,
  costByDay,
  providers,
}: {
  volumeByDay: readonly VolumePointDto[];
  costByDay: readonly CostPointDto[];
  providers: readonly DashboardProviderUsageDto[];
}) {
  const t = await getTranslations('dashboard');
  const tCommon = await getTranslations('common');
  const locale = await getLocale();
  const maxVolumeMinor = maxMinorUnits(volumeByDay.map((point) => point.minorUnits));
  const maxCostBps = maxDecimal(costByDay.map((point) => point.averageCostBps));
  const maxQuotes = Math.max(0, ...providers.map((provider) => provider.quoteCount));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title={t('chartVolumeTitle')}
        description={t('chartVolumeHint')}
        empty={volumeByDay.length === 0}
        emptyLabel={t('chartEmpty')}
      >
        <ul className="space-y-3">
          {volumeByDay.map((point) => {
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
                      locale,
                    )}
                  </span>
                </div>
                <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-chart-1 h-full rounded-full"
                    // Display-only CSS width. Not used in further calculation.
                    style={{ width: `${displayBarPercent(point.minorUnits, maxVolumeMinor)}%` }}
                    role="presentation"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </ChartCard>

      <ChartCard
        title={t('chartCostTitle')}
        description={t('chartCostHint')}
        empty={costByDay.length === 0}
        emptyLabel={t('chartEmpty')}
      >
        <ul className="space-y-3">
          {costByDay.map((point) => (
            <li key={point.date}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-mono text-xs">{point.date}</span>
                <span className="font-mono text-xs tabular-nums">
                  {t('chartCostPoint', {
                    bps: formatBps(point.averageCostBps, 1, locale),
                    quotes: tCommon('quotesCount', { count: point.quoteCount }),
                  })}
                </span>
              </div>
              <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
                <div
                  className="bg-chart-2 h-full rounded-full"
                  // Display-only CSS width. Not used in further calculation.
                  style={{
                    width: `${displayBarPercentFromDecimal(point.averageCostBps, maxCostBps)}%`,
                  }}
                  role="presentation"
                />
              </div>
            </li>
          ))}
        </ul>
      </ChartCard>

      <ChartCard
        title={t('chartProvidersTitle')}
        description={t('chartProvidersHint')}
        empty={providers.length === 0}
        emptyLabel={t('chartEmpty')}
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
                  {t('chartProviderPoint', {
                    quotes: tCommon('quotesCount', { count: provider.quoteCount }),
                    recommended: tCommon('recommendedCount', { count: provider.recommendedCount }),
                  })}
                </span>
              </div>
              <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
                <div
                  className="bg-chart-3 h-full rounded-full"
                  // Quote counts are not financial amounts; this width is display-only.
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
  emptyLabel,
  className,
  children,
}: {
  title: string;
  description: string;
  empty: boolean;
  emptyLabel: string;
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
        <p className="text-muted-foreground mt-4 text-sm">{emptyLabel}</p>
      ) : (
        <div className="mt-4">{children}</div>
      )}
    </section>
  );
}
