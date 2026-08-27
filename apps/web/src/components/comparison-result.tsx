'use client';

import { AlertTriangle, RefreshCw, TimerOff } from 'lucide-react';
import { BestRoute } from '@/components/best-route';
import { CostComparison } from '@/components/cost-comparison';
import { QuoteExpiryBadge, useQuoteExpiry } from '@/components/quote-expiry';
import { RouteCard } from '@/components/route-card';
import { VerifyReproducibility } from '@/components/verify-reproducibility';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ComparisonDto } from '@/lib/api/types';
import { formatTimestamp } from '@/lib/format';
import { earliestExpiry } from '@/lib/quote-expiry';

/**
 * The results, in the order a customer uses them: the best route to act on, the alternatives that
 * justify it, the cost comparison that shows how far apart they are, and the details underneath
 * each for anyone who wants to argue with a number.
 */
export function ComparisonResult({
  comparison,
  disclaimer,
  onRefresh,
  refreshing,
}: {
  comparison: ComparisonDto;
  disclaimer: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const best = comparison.routes.find((route) => route.recommended) ?? comparison.routes[0];
  const alternatives = comparison.routes.filter((route) => route !== best);

  // The comparison is only as fresh as its shortest-lived quote: once one price is gone, the
  // ranking was computed against something nobody can get any more.
  const comparisonExpiry = useQuoteExpiry(
    earliestExpiry(comparison.routes.map((route) => route.quote.expiresAt)),
  );

  return (
    <section
      className={`space-y-6 ${refreshing ? 'pointer-events-none opacity-60' : ''}`}
      aria-label="Route comparison results"
      aria-busy={refreshing}
    >
      {comparisonExpiry.state === 'expired' && (
        <Alert variant="destructive">
          <TimerOff aria-hidden />
          <AlertTitle>These quotes have expired</AlertTitle>
          <AlertDescription>
            <p>
              At least one provider&rsquo;s price has lapsed, so this ranking no longer reflects
              what you can get. Refresh to compare live quotes.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
              {refreshing ? 'Refreshing…' : 'Refresh quotes'}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {best !== undefined && <BestRoute route={best} />}

      {alternatives.length > 0 && (
        <section aria-label="Alternative routes" className="space-y-3">
          <h2 className="text-sm font-semibold">
            Alternative routes
            <span className="text-muted-foreground ml-2 font-normal">
              ranked by the same scoring, shown for the comparison
            </span>
          </h2>
          {alternatives.map((route) => (
            <RouteCard key={route.routeId} route={route} />
          ))}
        </section>
      )}

      <CostComparison comparison={comparison} />

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <VerifyReproducibility
            comparisonId={comparison.comparisonId}
            fingerprint={comparison.fingerprint}
          />
          <QuoteExpiryBadge
            expiresAt={earliestExpiry(comparison.routes.map((route) => route.quote.expiresAt))}
          />
        </div>
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
            <dd className="truncate font-mono">
              {Object.entries(comparison.scoringWeights)
                .filter(([, value]) => Number(value) > 0)
                .map(([key, value]) => `${key} ${value}`)
                .join(' · ')}
            </dd>
          </div>
        </dl>
        <p className="text-muted-foreground">{disclaimer}</p>
      </footer>
    </section>
  );
}
