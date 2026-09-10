'use client';

import { ChevronDown, Clock, ShieldCheck, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ContinueWithPartner } from '@/components/continue-with-partner';
import { CostBreakdown } from '@/components/cost-breakdown';
import { ProviderLicensingBadge } from '@/components/provider-licensing-badge';
import { QuoteExpiryBadge } from '@/components/quote-expiry';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { MoneyJson, RouteDto } from '@/lib/api/types';
import {
  formatMoney,
  formatPercent,
  formatRate,
  formatReliability,
} from '@/lib/format';
import { formatSettlementMessage } from '@/lib/format-i18n';

/**
 * The answer, given the prominence of one.
 *
 * Every figure the customer needs to act sits here without expanding anything: what they get, at
 * what rate, who charges what, how long it takes and how long the price holds. The alternatives
 * exist to justify this card, not to compete with it for attention.
 */
export function BestRoute({ route }: { route: RouteDto }) {
  const t = useTranslations('comparison');
  const tCommon = useTranslations('common');
  const tTime = useTranslations('time');
  const locale = useLocale();
  const [showDetails, setShowDetails] = useState(false);
  const providerFee = sumInTarget(
    route.breakdown.sourceFeeCost,
    route.breakdown.destinationFeeCost,
  );
  const settlement = (seconds: number) =>
    formatSettlementMessage(tTime, seconds, route.settlement.businessDaysOnly);

  return (
    <article
      aria-label={t('bestRouteLabel', { provider: route.provider.name })}
      className="rounded-xl border border-emerald-600/60 bg-emerald-50/50 dark:bg-emerald-950/20"
    >
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              {t('bestRoute')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{route.provider.name}</h2>
              <Badge variant="outline" className="text-xs">
                {route.provider.railLabel}
              </Badge>
              <ProviderLicensingBadge licensing={route.provider.licensing} />
              <Badge className="bg-emerald-600 text-xs text-white hover:bg-emerald-600">
                <Sparkles className="size-3" aria-hidden />
                {tCommon('recommended')}
              </Badge>
            </div>
            {route.quote.intermediaryAsset !== null && (
              <p className="text-muted-foreground text-xs">
                {t('middleLeg', { asset: route.quote.intermediaryAsset })}
              </p>
            )}
          </div>
          <QuoteExpiryBadge expiresAt={route.quote.expiresAt} />
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs">{t('beneficiaryReceives')}</p>
            <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
              {formatMoney(route.deliveredAmount, locale)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground text-xs">{t('estimatedTotalCost')}</p>
            <p className="text-xl font-semibold tabular-nums">
              {formatPercent(route.totalCostPercent, 2, locale)}
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                {formatMoney(route.totalCost, locale)}
              </span>
            </p>
          </div>
        </div>

        <Separator className="my-4" />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Field
            label={t('exchangeRate')}
            value={`${formatRate(route.offeredRate.value)} ${route.offeredRate.pair}`}
            hint={t('midMarket', { rate: formatRate(route.midMarketRate.value) })}
          />
          <Field
            label={t('providerFee')}
            value={formatMoney(providerFee, locale)}
            hint={t('providerFeeHint')}
          />
          <Field
            label={t('platformFee')}
            value={formatMoney(route.breakdown.platformFeeCost, locale)}
            hint={
              route.breakdown.platformFeeCost.minorUnits === '0'
                ? t('platformFeeNone')
                : t('platformFeeHint')
            }
          />
          <Field
            icon={<Clock className="size-3.5" aria-hidden />}
            label={t('settlementTime')}
            value={settlement(route.settlement.p50Seconds)}
            hint={tTime('p95', { value: settlement(route.settlement.p95Seconds) })}
          />
          <Field
            label={t('quoteExpires')}
            value={
              route.quote.expiresAt === null
                ? t('quoteExpiresNotStated')
                : timeOfDay(route.quote.expiresAt, locale)
            }
            hint={t('indicativeUntilThen')}
          />
          <Field
            icon={<ShieldCheck className="size-3.5" aria-hidden />}
            label={t('reliability')}
            value={formatReliability(route.reliabilityScore, locale)}
            hint={t('routeScore', { score: route.score })}
          />
        </dl>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <ContinueWithPartner providerName={route.provider.name} />
          <button
            type="button"
            onClick={() => setShowDetails((open) => !open)}
            aria-expanded={showDetails}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-colors"
          >
            {showDetails ? t('hideDetails') : t('showDetails')}
            <ChevronDown
              aria-hidden
              className={`size-3.5 transition-transform ${showDetails ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {showDetails && (
        <div className="border-border/60 border-t px-4 py-4 sm:px-6">
          <CostBreakdown route={route} />
        </div>
      )}
    </article>
  );
}

function Field({
  icon,
  label,
  value,
  hint,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground flex items-center gap-1 text-xs">
        {icon}
        {label}
      </dt>
      <dd className="truncate font-medium tabular-nums" title={value}>
        {value}
      </dd>
      {hint !== undefined && <dd className="text-muted-foreground truncate text-xs">{hint}</dd>}
    </div>
  );
}

/**
 * Provider charges as one figure, in the destination currency.
 *
 * Source-side and destination-side fees arrive in different currencies; the breakdown values both at
 * the mid-market rate, so their sum is the honest single number for "what does the provider charge".
 */
function sumInTarget(sourceFeeCost: MoneyJson, destinationFeeCost: MoneyJson): MoneyJson {
  const total = BigInt(sourceFeeCost.minorUnits) + BigInt(destinationFeeCost.minorUnits);
  return { ...sourceFeeCost, minorUnits: total.toString(), decimal: '' };
}

function timeOfDay(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    hourCycle: 'h23',
  }).format(date)} UTC`;
}
