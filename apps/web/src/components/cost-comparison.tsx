'use client';

import { TrendingDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ComparisonDto } from '@/lib/api/types';
import { displayBarPercentFromDecimal, maxDecimal } from '@/lib/chart-display';
import { formatMoney, formatPercent, formatRate } from '@/lib/format';
import { ProviderLicensingBadge } from '@/components/provider-licensing-badge';

/**
 * Every route's all-in cost on one axis, measured against mid-market (0 bps baseline).
 */
export function CostComparison({ comparison }: { comparison: ComparisonDto }) {
  const t = useTranslations('comparison');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const routes = comparison.routes;
  if (routes.length < 2) {
    return null;
  }

  const maxCostBps = maxDecimal(routes.map((route) => route.totalCostBps));
  const insights = comparison.insights;
  const referenceRoute = routes.find((route) => route.recommended) ?? routes[0];

  return (
    <section
      aria-label={t('costComparison')}
      className="marketing-surface rounded-xl p-4 sm:p-5"
    >
      <h2 className="text-sm font-semibold">{t('costComparison')}</h2>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {t('costComparisonHint')}{' '}
        {referenceRoute !== undefined && (
          <span className="text-muted-foreground/90">
            · {t('midMarket', { rate: formatRate(referenceRoute.midMarketRate.value) })}
          </span>
        )}
      </p>

      <ul className="mt-4 space-y-3">
        {routes.map((route) => {
          const width = displayBarPercentFromDecimal(route.totalCostBps, maxCostBps);

          return (
            <li key={route.routeId}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="inline-flex min-w-0 items-center gap-2 truncate">
                  {route.provider.name}
                  <ProviderLicensingBadge licensing={route.provider.licensing} />
                  {route.recommended && (
                    <span className="text-accent text-xs font-semibold uppercase tracking-wide">
                      {tCommon('best')}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums">
                  {formatPercent(route.totalCostPercent, 2, locale)} ·{' '}
                  {formatMoney(route.totalCost, locale)}
                </span>
              </div>
              <div className="bg-muted/80 relative mt-1 h-1.5 overflow-hidden rounded-full">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none ${
                    route.recommended ? 'bg-accent' : 'bg-primary/65'
                  }`}
                  style={{ width: `${width}%` }}
                  role="presentation"
                />
              </div>
            </li>
          );
        })}
      </ul>

      {insights !== null && (
        <div className="text-muted-foreground mt-4 space-y-1 text-xs">
          <p className="flex items-center gap-1.5">
            <TrendingDown className="text-accent size-3.5 shrink-0" aria-hidden />
            {t('savesVsMostExpensive', {
              amount: formatMoney(insights.savingsVsMostExpensive, locale),
            })}
          </p>
          {insights.savingsVsBankFx !== null && (
            <p className="pl-5">
              {t('savesVsBank', { amount: formatMoney(insights.savingsVsBankFx, locale) })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
