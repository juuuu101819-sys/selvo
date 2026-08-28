import type { MoneyJson, RouteDto } from '@/lib/api/types';
import { formatBps, formatMoney, formatRate, formatTimestamp } from '@/lib/format';

/**
 * Shows where the money went.
 *
 * Every component is valued in the destination currency and the four of them plus the rounding
 * residue add up to the total exactly — the engine guarantees this, and showing it is what lets a
 * treasury team argue with a provider about a specific number instead of a headline percentage.
 */
export function CostBreakdown({ route }: { route: RouteDto }) {
  const { breakdown } = route;

  const rows: readonly { label: string; hint?: string; amount: MoneyJson }[] = [
    {
      label: 'FX spread',
      hint: `Offered ${formatRate(route.offeredRate.value)} against mid-market ${formatRate(
        route.midMarketRate.value,
      )}`,
      amount: breakdown.fxSpreadCost,
    },
    {
      label: 'Sending fees',
      hint: 'Valued at the mid-market rate',
      amount: breakdown.sourceFeeCost,
    },
    {
      label: 'Meridian platform fee',
      hint: 'Charged by Meridian, not the provider',
      amount: breakdown.platformFeeCost,
    },
    { label: 'Receiving fees', amount: breakdown.destinationFeeCost },
    {
      label: 'Expected slippage',
      hint:
        Number(route.slippageBps) > 0 ? formatBps(route.slippageBps) : 'Firm price, no slippage',
      amount: breakdown.slippageCost,
    },
  ];

  return (
    <div className="space-y-4 text-sm">
      <div>
        <table className="w-full">
          <caption className="text-muted-foreground mb-2 text-left text-xs">
            All figures in {route.totalCost.currency}, measured against a mid-market benchmark of{' '}
            {formatMoney(route.benchmarkAmount)}.
          </caption>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-border/40 border-b last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal align-top">
                  {row.label}
                  {row.hint !== undefined && (
                    <span className="text-muted-foreground block text-xs">{row.hint}</span>
                  )}
                </th>
                <td className="py-2 text-right font-mono tabular-nums">
                  {formatMoney(row.amount)}
                </td>
              </tr>
            ))}
            {breakdown.roundingAdjustment.minorUnits !== '0' && (
              <tr className="border-border/40 border-b last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  Rounding
                  <span className="text-muted-foreground block text-xs">
                    Sub-minor-unit residue, so the breakdown balances exactly
                  </span>
                </th>
                <td className="py-2 text-right font-mono tabular-nums">
                  {formatMoney(breakdown.roundingAdjustment)}
                </td>
              </tr>
            )}
            <tr>
              <th scope="row" className="pt-3 pr-3 text-left font-semibold">
                Total cost
              </th>
              <td className="pt-3 text-right font-mono font-semibold tabular-nums">
                {formatMoney(breakdown.totalCost)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {breakdown.appliedFees.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fees applied
          </h4>
          <ul className="space-y-1">
            {breakdown.appliedFees.map((fee) => (
              <li key={`${fee.side}-${fee.code}`} className="flex justify-between gap-3">
                <span>
                  {fee.label}
                  <span className="text-muted-foreground ml-1 text-xs">
                    ({fee.side === 'source' ? 'sending' : 'receiving'}
                    {fee.rateBps !== null ? `, ${formatBps(fee.rateBps)}` : ''}
                    {fee.capped ? ', capped' : ''})
                  </span>
                </span>
                <span className="font-mono tabular-nums">{formatMoney(fee.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
        <div className="flex gap-1">
          <dt>Quoted at</dt>
          <dd className="font-mono">{formatTimestamp(route.quote.quotedAt)}</dd>
        </div>
        {route.quote.freshness !== null && route.quote.freshness !== undefined && (
          <div className="flex gap-1">
            <dt>Quote age</dt>
            <dd className="font-mono">
              {route.quote.freshness.ageSeconds}s ({route.quote.freshness.state})
            </dd>
          </div>
        )}
        {route.quote.expiresAt !== null && (
          <div className="flex gap-1">
            <dt>Quote expires</dt>
            <dd className="font-mono">{formatTimestamp(route.quote.expiresAt)}</dd>
          </div>
        )}
        {route.quote.quoteReference !== null && (
          <div className="flex gap-1">
            <dt>Provider reference</dt>
            <dd className="font-mono">{route.quote.quoteReference}</dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt>Pricing version</dt>
          <dd className="font-mono">{route.quote.pricingVersion}</dd>
        </div>
      </dl>
    </div>
  );
}
