import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DashboardMetricsDto } from '@/lib/api/types';
import { formatBps, formatQuotedAmount } from '@/lib/format';
import { formatSettlementMessage } from '@/lib/format-i18n';

export async function MetricsGrid({ metrics }: { metrics: DashboardMetricsDto }) {
  const t = await getTranslations('dashboard');
  const tCommon = await getTranslations('common');
  const tTime = await getTranslations('time');
  const locale = await getLocale();

  const amountsList = (
    rows: readonly { currency: string; exponent: number; minorUnits: string }[],
  ): string => {
    if (rows.length === 0) {
      return tCommon('emDash');
    }
    return rows
      .map((row) => formatQuotedAmount(row.minorUnits, row.currency, row.exponent, locale))
      .join(' · ');
  };

  const cards = [
    {
      title: t('metricVolume'),
      value: amountsList(metrics.totalQuotedVolume),
      hint: t('metricVolumeHint'),
    },
    {
      title: t('metricSavings'),
      value: amountsList(metrics.estimatedSavings),
      hint: t('metricSavingsHint'),
    },
    {
      title: t('metricQuotes'),
      value: String(metrics.quoteCount),
      hint: t('metricQuotesHint'),
    },
    {
      title: t('metricSuccessful'),
      value: String(metrics.successfulRouteRequests),
      hint: t('metricSuccessfulHint'),
    },
    {
      title: t('metricAvgCost'),
      value:
        metrics.averageRouteCostBps === null
          ? tCommon('emDash')
          : formatBps(metrics.averageRouteCostBps, 1, locale),
      hint: t('metricAvgCostHint'),
    },
    {
      title: t('metricAvgSettlement'),
      value:
        metrics.averageSettlementP50Seconds === null
          ? tCommon('emDash')
          : formatSettlementMessage(tTime, metrics.averageSettlementP50Seconds, false),
      hint: t('metricAvgSettlementHint'),
    },
  ];

  return (
    <section aria-label={t('metricsAria')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.title} size="sm">
          <CardHeader>
            <CardDescription>{card.title}</CardDescription>
            <CardTitle className="font-mono text-lg tabular-nums">{card.value}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">{card.hint}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
