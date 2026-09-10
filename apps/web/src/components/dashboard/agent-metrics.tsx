import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AgentDashboardSummaryDto } from '@/lib/api/types';
import { formatBps, formatQuotedAmount } from '@/lib/format';

export async function AgentMetricsGrid({ summary }: { summary: AgentDashboardSummaryDto }) {
  const t = await getTranslations('agents');
  const tCommon = await getTranslations('common');
  const locale = await getLocale();

  const cards = [
    {
      title: t('metricVolume'),
      value: formatQuotedAmount(
        summary.paymentVolumeMinorUnits,
        summary.currency,
        summary.exponent,
        locale,
      ),
      hint: t('metricVolumeHint'),
    },
    {
      title: t('metricTx'),
      value: String(summary.transactionCount),
      hint: t('metricTxHint', { completed: summary.completedCount, failed: summary.failedCount }),
    },
    {
      title: t('metricFee'),
      value:
        summary.averageFeeBps === null
          ? tCommon('emDash')
          : formatBps(summary.averageFeeBps, 2, locale),
      hint: t('metricFeeHint'),
    },
    {
      title: t('metricSuccess'),
      value:
        summary.routeSuccessRatePercent === null
          ? tCommon('emDash')
          : `${summary.routeSuccessRatePercent}%`,
      hint: t('metricSuccessHint'),
    },
    {
      title: t('metricPreferred'),
      value: summary.preferredRoute?.providerName ?? tCommon('emDash'),
      hint: summary.preferredRoute
        ? t('metricPreferredHint', {
            rail: summary.preferredRoute.rail.replaceAll('_', ' '),
            count: summary.preferredRoute.intentCount,
          })
        : t('metricPreferredNone'),
    },
    {
      title: t('metricViolations'),
      value: String(summary.policyViolationCount),
      hint: t('metricViolationsHint'),
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
