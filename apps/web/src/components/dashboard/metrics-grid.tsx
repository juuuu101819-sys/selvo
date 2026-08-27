import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DashboardMetricsDto } from '@/lib/api/types';
import { formatBps, formatQuotedAmount, formatSettlement } from '@/lib/format';

function amountsList(
  rows: readonly { currency: string; exponent: number; minorUnits: string }[],
): string {
  if (rows.length === 0) {
    return '—';
  }
  return rows
    .map((row) => formatQuotedAmount(row.minorUnits, row.currency, row.exponent))
    .join(' · ');
}

export function MetricsGrid({ metrics }: { metrics: DashboardMetricsDto }) {
  const cards = [
    {
      title: 'Total quoted volume',
      value: amountsList(metrics.totalQuotedVolume),
      hint: 'Sum of transaction requests, counted once per payment rather than once per quote.',
    },
    {
      title: 'Estimated savings',
      value: amountsList(metrics.estimatedSavings),
      hint: 'Recommended route cost versus the most expensive quote on the same request.',
    },
    {
      title: 'Quotes',
      value: String(metrics.quoteCount),
      hint: 'Every stored provider quote scoped to this organization.',
    },
    {
      title: 'Successful route requests',
      value: String(metrics.successfulRouteRequests),
      hint: 'Requests that reached quoted or quote-selected status.',
    },
    {
      title: 'Average route cost',
      value: metrics.averageRouteCostBps === null ? '—' : formatBps(metrics.averageRouteCostBps),
      hint: 'Mean all-in cost of recommended quotes, in basis points against mid-market.',
    },
    {
      title: 'Average settlement estimate',
      value:
        metrics.averageSettlementP50Seconds === null
          ? '—'
          : formatSettlement(metrics.averageSettlementP50Seconds, false),
      hint: 'Mean p50 settlement time of recommended quotes.',
    },
  ];

  return (
    <section aria-label="Dashboard metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
