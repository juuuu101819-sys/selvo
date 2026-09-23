'use client';

import { AlertTriangle, RefreshCw, TimerOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BestRoute } from '@/components/best-route';
import { CostComparison } from '@/components/cost-comparison';
import { QuoteExpiryBadge, useQuoteExpiry } from '@/components/quote-expiry';
import { RouteCard, type RouteDimensionLeaders } from '@/components/route-card';
import { VerifyReproducibility } from '@/components/verify-reproducibility';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ComparisonDto, RouteDto } from '@/lib/api/types';
import { formatTimestamp } from '@/lib/format';
import { earliestExpiry } from '@/lib/quote-expiry';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(media.matches);
    const onChange = (): void => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

function computeDimensionLeaders(routes: readonly RouteDto[]): RouteDimensionLeaders {
  if (routes.length === 0) {
    return { lowestCostBps: '', fastestP50: 0, highestReliability: '' };
  }

  let lowestCostBps = routes[0]!.totalCostBps;
  let lowestCostValue = Number(routes[0]!.totalCostBps);
  let fastestP50 = routes[0]!.settlement.p50Seconds;
  let highestReliability = routes[0]!.reliabilityScore;
  let highestReliabilityValue = Number(routes[0]!.reliabilityScore);

  for (const route of routes) {
    const costValue = Number(route.totalCostBps);
    if (costValue < lowestCostValue) {
      lowestCostValue = costValue;
      lowestCostBps = route.totalCostBps;
    }
    if (route.settlement.p50Seconds < fastestP50) {
      fastestP50 = route.settlement.p50Seconds;
    }
    const reliabilityValue = Number(route.reliabilityScore);
    if (reliabilityValue > highestReliabilityValue) {
      highestReliabilityValue = reliabilityValue;
      highestReliability = route.reliabilityScore;
    }
  }

  return { lowestCostBps, fastestP50, highestReliability };
}

function FlipRouteList({
  comparisonId,
  routeIds,
  reducedMotion,
  children,
}: {
  comparisonId: string;
  routeIds: readonly string[];
  reducedMotion: boolean;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const firstPositionsRef = useRef<Map<string, DOMRect>>(new Map());
  const routeIdsKey = routeIds.join('|');

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const record = (): void => {
      const next = new Map<string, DOMRect>();
      container.querySelectorAll('[data-flip-id]').forEach((node) => {
        const id = node.getAttribute('data-flip-id');
        if (id) {
          next.set(id, node.getBoundingClientRect());
        }
      });
      firstPositionsRef.current = next;
    };

    if (!reducedMotion && firstPositionsRef.current.size > 0) {
      container.querySelectorAll('[data-flip-id]').forEach((node) => {
        const id = node.getAttribute('data-flip-id');
        if (!id) {
          return;
        }
        const first = firstPositionsRef.current.get(id);
        if (!first) {
          return;
        }
        const last = node.getBoundingClientRect();
        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
          return;
        }
        const element = node as HTMLElement;
        element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        element.style.transition = 'transform 0s';
        requestAnimationFrame(() => {
          element.style.transition = 'transform 450ms cubic-bezier(0.22, 1, 0.36, 1)';
          element.style.transform = '';
        });
      });
    }

    record();
  }, [comparisonId, routeIdsKey, reducedMotion]);

  return (
    <div ref={containerRef} className="space-y-3">
      {children}
    </div>
  );
}

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
  const reducedMotion = usePrefersReducedMotion();

  const sortedRoutes = useMemo(
    () => [...comparison.routes].sort((a, b) => a.rank - b.rank),
    [comparison.routes],
  );

  const best = sortedRoutes.find((route) => route.recommended) ?? sortedRoutes[0];
  const alternatives = sortedRoutes.filter((route) => route !== best);
  const dimensionLeaders = useMemo(
    () => computeDimensionLeaders(comparison.routes),
    [comparison.routes],
  );
  const maxCostBps = useMemo(() => {
    let max = 0n;
    for (const route of comparison.routes) {
      const whole = route.totalCostBps.split('.')[0] ?? '0';
      const value = BigInt(whole);
      if (value > max) {
        max = value;
      }
    }
    return max.toString();
  }, [comparison.routes]);

  const maxSettlementP50 = useMemo(
    () => Math.max(...comparison.routes.map((route) => route.settlement.p50Seconds), 1),
    [comparison.routes],
  );

  const prevBestIdRef = useRef<string | null>(null);
  const [crownFlash, setCrownFlash] = useState(false);

  useEffect(() => {
    const currentBestId = best?.routeId ?? null;
    if (
      prevBestIdRef.current !== null &&
      currentBestId !== null &&
      prevBestIdRef.current !== currentBestId
    ) {
      setCrownFlash(true);
      const timer = window.setTimeout(() => setCrownFlash(false), 750);
      prevBestIdRef.current = currentBestId;
      return () => window.clearTimeout(timer);
    }
    prevBestIdRef.current = currentBestId;
    return undefined;
  }, [best?.routeId, comparison.comparisonId]);

  const comparisonExpiry = useQuoteExpiry(
    earliestExpiry(comparison.routes.map((route) => route.quote.expiresAt)),
  );

  return (
    <section
      className={`space-y-6 transition-opacity duration-300 ${refreshing ? 'pointer-events-none opacity-70' : ''}`}
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

      <FlipRouteList
        comparisonId={comparison.comparisonId}
        routeIds={sortedRoutes.map((route) => route.routeId)}
        reducedMotion={reducedMotion}
      >
        {sortedRoutes.map((route, index) => (
          <div key={route.routeId} data-flip-id={route.routeId} className="will-change-transform">
            {index === 1 && alternatives.length > 0 ? (
              <h2 className="text-sm font-semibold pb-3">
                {t('alternativeRoutes')}
                <span className="text-muted-foreground ml-2 font-normal">{t('alternativeHint')}</span>
              </h2>
            ) : null}
            {index === 0 ? (
              <BestRoute
                route={route}
                scoringWeights={comparison.scoringWeights}
                insights={comparison.insights}
                crownFlash={crownFlash && !reducedMotion}
              />
            ) : (
              <RouteCard
                route={route}
                dimensionLeaders={dimensionLeaders}
                maxCostBps={maxCostBps}
                maxSettlementP50={maxSettlementP50}
              />
            )}
          </div>
        ))}
      </FlipRouteList>

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

      <footer className="border-border/60 marketing-surface space-y-3 rounded-xl border border-dashed p-4 text-xs">
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
