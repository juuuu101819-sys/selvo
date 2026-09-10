'use client';

import { AlertTriangle, RefreshCw, TimerOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
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
  const t = useTranslations('comparison');
  const tCommon = useTranslations('common');
  const locale = useLocale();
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
      aria-label={t('resultsLabel')}
      aria-busy={refreshing}
    >
      {comparisonExpiry.state === 'expired' && (
        <Alert variant="destructive">
          <TimerOff aria-hidden />
          <AlertTitle>{t('expiredTitle')}</AlertTitle>
          <AlertDescription>
            <p>{t('expiredBody')}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
              {refreshing ? tCommon('refreshing') : t('refreshQuotes')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {best !== undefined && <BestRoute route={best} />}

      {alternatives.length > 0 && (
        <section aria-label={t('alternativeRoutes')} className="space-y-3">
          <h2 className="text-sm font-semibold">
            {t('alternativeRoutes')}
            <span className="text-muted-foreground ml-2 font-normal">{t('alternativeHint')}</span>
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
          <AlertTitle>{t('providerFailures', { count: comparison.providerFailures.length })}</AlertTitle>
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
            <dt>{t('comparisonId')}</dt>
            <dd className="truncate font-mono">{comparison.comparisonId}</dd>
          </div>
          <div className="flex gap-1">
            <dt>{t('requested')}</dt>
            <dd className="font-mono">{formatTimestamp(comparison.request.requestedAt, locale)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>{t('engine')}</dt>
            <dd className="font-mono">{comparison.engineVersion}</dd>
          </div>
          <div className="flex gap-1">
            <dt>{t('weights')}</dt>
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
