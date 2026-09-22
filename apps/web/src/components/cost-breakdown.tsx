'use client';

import { useLocale, useTranslations } from 'next-intl';
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
  const t = useTranslations('comparison');
  const locale = useLocale();
  const { breakdown } = route;

  const rows: readonly { label: string; hint?: string; amount: MoneyJson }[] = [
    {
      label: t('fxSpread'),
      hint: t('fxSpreadHint', {
        offered: formatRate(route.offeredRate.value),
        mid: formatRate(route.midMarketRate.value),
      }),
      amount: breakdown.fxSpreadCost,
    },
    {
      label: t('sendingFees'),
      hint: t('valuedAtMid'),
      amount: breakdown.sourceFeeCost,
    },
    {
      label: t('meridianPlatformFee'),
      hint: t('chargedByMeridian'),
      amount: breakdown.platformFeeCost,
    },
    { label: t('receivingFees'), amount: breakdown.destinationFeeCost },
    {
      label: t('expectedSlippage'),
      hint:
        Number(route.slippageBps) > 0
          ? formatBps(route.slippageBps, 1, locale)
          : t('firmPrice'),
      amount: breakdown.slippageCost,
    },
  ];

  return (
    <div className="space-y-4 text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-300">
      <div>
        <table className="w-full">
          <caption className="text-muted-foreground mb-2 text-left text-xs">
            {t('breakdownCaption', {
              currency: route.totalCost.currency,
              amount: formatMoney(route.benchmarkAmount, locale),
            })}
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
                  {formatMoney(row.amount, locale)}
                </td>
              </tr>
            ))}
            {breakdown.roundingAdjustment.minorUnits !== '0' && (
              <tr className="border-border/40 border-b last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  {t('rounding')}
                  <span className="text-muted-foreground block text-xs">{t('roundingHint')}</span>
                </th>
                <td className="py-2 text-right font-mono tabular-nums">
                  {formatMoney(breakdown.roundingAdjustment, locale)}
                </td>
              </tr>
            )}
            <tr>
              <th scope="row" className="pt-3 pr-3 text-left font-semibold">
                {t('totalCostLabel')}
              </th>
              <td className="pt-3 text-right font-mono font-semibold tabular-nums">
                {formatMoney(breakdown.totalCost, locale)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {breakdown.appliedFees.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('feesApplied')}
          </h4>
          <ul className="space-y-1">
            {breakdown.appliedFees.map((fee) => (
              <li key={`${fee.side}-${fee.code}`} className="flex justify-between gap-3">
                <span>
                  {fee.label}
                  <span className="text-muted-foreground ml-1 text-xs">
                    ({fee.side === 'source' ? t('sending') : t('receiving')}
                    {fee.rateBps !== null ? `, ${formatBps(fee.rateBps, 1, locale)}` : ''}
                    {fee.capped ? `, ${t('capped')}` : ''})
                  </span>
                </span>
                <span className="font-mono tabular-nums">{formatMoney(fee.amount, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
        <div className="flex gap-1">
          <dt>{t('quotedAt')}</dt>
          <dd className="font-mono">{formatTimestamp(route.quote.quotedAt, locale)}</dd>
        </div>
        {route.quote.freshness !== null && route.quote.freshness !== undefined && (
          <div className="flex gap-1">
            <dt>{t('quoteAge')}</dt>
            <dd className="font-mono">
              {t('quoteAgeValue', {
                count: route.quote.freshness.ageSeconds,
                state: route.quote.freshness.state,
              })}
            </dd>
          </div>
        )}
        {route.quote.expiresAt !== null && (
          <div className="flex gap-1">
            <dt>{t('quoteExpires')}</dt>
            <dd className="font-mono">{formatTimestamp(route.quote.expiresAt, locale)}</dd>
          </div>
        )}
        {route.quote.quoteReference !== null && (
          <div className="flex gap-1">
            <dt>{t('providerReference')}</dt>
            <dd className="font-mono">{route.quote.quoteReference}</dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt>{t('pricingVersion')}</dt>
          <dd className="font-mono">{route.quote.pricingVersion}</dd>
        </div>
      </dl>
    </div>
  );
}
