'use client';

import { TrendingDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ComparisonDto } from '@/lib/api/types';
import { displayBarPercentFromDecimal, maxDecimal } from '@/lib/chart-display';
import { formatMoney, formatPercent } from '@/lib/format';
import { ProviderLicensingBadge } from '@/components/provider-licensing-badge';

/**
 * Every route's all-in cost on one axis.
 *
 * The route cards answer "what do I get"; this section answers "how far apart are they", which is
 * the argument for switching rails. Plain CSS bars rather than a charting library: four values on
 * one axis do not justify a dependency, and the bars inherit the page's typography and theme for
 * free.
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

  return (
    <section
      aria-label={t('costComparison')}
      className="border-border rounded-xl border p-4 sm:p-5"
    >
      <h2 className="text-sm font-semibold">{t('costComparison')}</h2>
      <p className="text-muted-foreground mt-0.5 text-xs">{t('costComparisonHint')}</p>

      <ul className="mt-4 space-y-3">
        {routes.map((route) => {
          // Display-only CSS width. Not used in further calculation.
          const width = displayBarPercentFromDecimal(route.totalCostBps, maxCostBps);

          return (
            <li key={route.routeId}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate inline-flex items-center gap-2">
                  {route.provider.name}
                  <ProviderLicensingBadge licensing={route.provider.licensing} />
                  {route.recommended && (
                    <span className="text-recommend ml-2 text-xs font-medium">
                      {' '}
                      {tCommon('best')}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums">
                  {formatPercent(route.totalCostPercent, 2, locale)} ·{' '}
                  {formatMoney(route.totalCost, locale)}
                </span>
              </div>
              <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
                <div
                  className={`h-full rounded-full ${
                    route.recommended ? 'bg-recommend' : 'bg-foreground/30'
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
            <TrendingDown className="text-recommend size-3.5 shrink-0" aria-hidden />
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
