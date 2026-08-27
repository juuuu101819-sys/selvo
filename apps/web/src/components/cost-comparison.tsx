import { TrendingDown } from 'lucide-react';
import type { ComparisonDto } from '@/lib/api/types';
import { formatMoney, formatPercent } from '@/lib/format';

/**
 * Every route's all-in cost on one axis.
 *
 * The route cards answer "what do I get"; this section answers "how far apart are they", which is
 * the argument for switching rails. Plain CSS bars rather than a charting library: four values on
 * one axis do not justify a dependency, and the bars inherit the page's typography and theme for
 * free.
 */
export function CostComparison({ comparison }: { comparison: ComparisonDto }) {
  const routes = comparison.routes;
  if (routes.length < 2) {
    return null;
  }

  const maxCostBps = Math.max(...routes.map((route) => Number(route.totalCostBps)));
  const insights = comparison.insights;

  return (
    <section aria-label="Cost comparison" className="border-border rounded-xl border p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Cost comparison</h2>
      <p className="text-muted-foreground mt-0.5 text-xs">
        All-in cost of each route against the same mid-market benchmark, so the bars are comparable.
      </p>

      <ul className="mt-4 space-y-3">
        {routes.map((route) => {
          const cost = Number(route.totalCostBps);
          // A subsidised route can price below the benchmark; the bar floors at a sliver so the row
          // is still visibly present rather than rendering as nothing.
          const width = maxCostBps <= 0 ? 100 : Math.max((cost / maxCostBps) * 100, 2);

          return (
            <li key={route.routeId}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {route.provider.name}
                  {route.recommended && (
                    <span className="ml-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      {' '}
                      best
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums">
                  {formatPercent(route.totalCostPercent)} · {formatMoney(route.totalCost)}
                </span>
              </div>
              <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
                <div
                  className={`h-full rounded-full ${
                    route.recommended ? 'bg-emerald-600' : 'bg-foreground/30'
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
            <TrendingDown className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
            Best route saves {formatMoney(insights.savingsVsMostExpensive)} against the most
            expensive option.
          </p>
          {insights.savingsVsBankFx !== null && (
            <p className="pl-5">
              {formatMoney(insights.savingsVsBankFx)} against the traditional bank route.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
