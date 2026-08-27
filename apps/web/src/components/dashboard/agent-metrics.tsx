import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AgentDashboardSummaryDto } from '@/lib/api/types';
import { formatBps, formatQuotedAmount } from '@/lib/format';

export function AgentMetricsGrid({ summary }: { summary: AgentDashboardSummaryDto }) {
  const cards = [
    {
      title: 'Payment volume',
      value: formatQuotedAmount(summary.paymentVolumeMinorUnits, summary.currency, summary.exponent),
      hint: 'Quoted and simulated notional in the reporting asset. Includes failed intents.',
    },
    {
      title: 'Transactions',
      value: String(summary.transactionCount),
      hint: `${summary.completedCount} completed simulations, ${summary.failedCount} failed.`,
    },
    {
      title: 'Average fee',
      value: summary.averageFeeBps === null ? '—' : formatBps(summary.averageFeeBps, 2),
      hint: 'Mean all-in cost of the selected, recommended or first quoted route.',
    },
    {
      title: 'Route success rate',
      value:
        summary.routeSuccessRatePercent === null ? '—' : `${summary.routeSuccessRatePercent}%`,
      hint: 'Completed simulations divided by completed plus failed.',
    },
    {
      title: 'Preferred route',
      value: summary.preferredRoute?.providerName ?? '—',
      hint: summary.preferredRoute
        ? `${summary.preferredRoute.rail.replaceAll('_', ' ')} · ${summary.preferredRoute.intentCount} intents`
        : 'No quoted route yet.',
    },
    {
      title: 'Policy violations',
      value: String(summary.policyViolationCount),
      hint: 'Fail-closed denials recorded for this agent.',
    },
  ];

  return (
    <section aria-label="Agent financial metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
