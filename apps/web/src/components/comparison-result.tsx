'use client';

import { AlertTriangle, TrendingDown } from 'lucide-react';
import { RouteCard } from '@/components/route-card';
import { VerifyReproducibility } from '@/components/verify-reproducibility';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ComparisonDto } from '@/lib/api/types';
import { formatMoney, formatPercent, formatSettlement, formatTimestamp } from '@/lib/format';

export function ComparisonResult({
  comparison,
  disclaimer,
}: {
  comparison: ComparisonDto;
  disclaimer: string;
}) {
  const recommended = comparison.routes.find((route) => route.recommended);

  return (
    <section className="space-y-4" aria-label="Route comparison results">
      {recommended !== undefined && (
        <div className="rounded-xl border border-emerald-600/40 bg-emerald-600/5 p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Recommended route
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            {recommended.provider.name}
            <span className="text-muted-foreground font-normal">
              {' '}
              · {recommended.provider.railLabel}
            </span>
          </h2>
          <p className="mt-2 text-sm">
            {formatMoney(comparison.request.amount)} arrives as{' '}
            <strong className="tabular-nums">{formatMoney(recommended.deliveredAmount)}</strong> for
            an all-in cost of{' '}
            <strong className="tabular-nums">{formatPercent(recommended.totalCostPercent)}</strong>,
            settling in{' '}
            <strong>
              {formatSettlement(
                recommended.settlement.p50Seconds,
                recommended.settlement.businessDaysOnly,
              )}
            </strong>
            .
          </p>

          {comparison.insights?.savingsVsBankFx !== null &&
            comparison.insights?.savingsVsBankFx !== undefined && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-800 dark:text-emerald-300">
                <TrendingDown className="size-4 shrink-0" aria-hidden />
                Saves {formatMoney(comparison.insights.savingsVsBankFx)} against the cheapest
                traditional bank route.
              </p>
            )}
        </div>
      )}

      <div className="space-y-3">
        {comparison.routes.map((route) => (
          <RouteCard key={route.routeId} route={route} />
        ))}
      </div>

      {comparison.providerFailures.length > 0 && (
        <Alert variant="default">
          <AlertTriangle aria-hidden />
          <AlertTitle>
            {comparison.providerFailures.length} provider
            {comparison.providerFailures.length === 1 ? '' : 's'} could not quote
          </AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc">
              {comparison.providerFailures.map((failure) => (
                <li key={failure.providerId}>
                  <span className="font-mono text-xs">{failure.providerId}</span>: {failure.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <footer className="border-border/60 space-y-3 rounded-xl border border-dashed p-4 text-xs">
        <VerifyReproducibility
          comparisonId={comparison.comparisonId}
          fingerprint={comparison.fingerprint}
        />
        <dl className="text-muted-foreground grid gap-1 sm:grid-cols-2">
          <div className="flex gap-1">
            <dt>Comparison</dt>
            <dd className="truncate font-mono">{comparison.comparisonId}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Requested</dt>
            <dd className="font-mono">{formatTimestamp(comparison.request.requestedAt)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Engine</dt>
            <dd className="font-mono">{comparison.engineVersion}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Weights</dt>
            <dd className="font-mono">
              cost {comparison.scoringWeights.cost} · speed {comparison.scoringWeights.speed} ·
              reliability {comparison.scoringWeights.reliability}
            </dd>
          </div>
        </dl>
        <p className="text-muted-foreground">{disclaimer}</p>
      </footer>
    </section>
  );
}
