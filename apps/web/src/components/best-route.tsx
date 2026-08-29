'use client';

import { ChevronDown, Clock, ShieldCheck, Sparkles } from 'lucide-react';
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
  formatSettlement,
} from '@/lib/format';

/**
 * The answer, given the prominence of one.
 *
 * Every figure the customer needs to act sits here without expanding anything: what they get, at
 * what rate, who charges what, how long it takes and how long the price holds. The alternatives
 * exist to justify this card, not to compete with it for attention.
 */
export function BestRoute({ route }: { route: RouteDto }) {
  const [showDetails, setShowDetails] = useState(false);
  const providerFee = sumInTarget(
    route.breakdown.sourceFeeCost,
    route.breakdown.destinationFeeCost,
  );

  return (
    <article
      aria-label={`Best route: ${route.provider.name}`}
      className="rounded-xl border border-emerald-600/60 bg-emerald-50/50 dark:bg-emerald-950/20"
    >
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Best route
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{route.provider.name}</h2>
              <Badge variant="outline" className="text-xs">
                {route.provider.railLabel}
              </Badge>
              <ProviderLicensingBadge licensing={route.provider.licensing} />
              <Badge className="bg-emerald-600 text-xs text-white hover:bg-emerald-600">
                <Sparkles className="size-3" aria-hidden />
                Recommended
              </Badge>
            </div>
            {route.quote.intermediaryAsset !== null && (
              <p className="text-muted-foreground text-xs">
                Settles the middle leg in {route.quote.intermediaryAsset} through licensed partners.
                Meridian never holds the asset.
              </p>
            )}
          </div>
          <QuoteExpiryBadge expiresAt={route.quote.expiresAt} />
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs">Beneficiary receives</p>
            <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
              {formatMoney(route.deliveredAmount)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground text-xs">Estimated total cost</p>
            <p className="text-xl font-semibold tabular-nums">
              {formatPercent(route.totalCostPercent)}
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                {formatMoney(route.totalCost)}
              </span>
            </p>
          </div>
        </div>

        <Separator className="my-4" />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Field
            label="Exchange rate"
            value={`${formatRate(route.offeredRate.value)} ${route.offeredRate.pair}`}
            hint={`Mid-market ${formatRate(route.midMarketRate.value)}`}
          />
          <Field
            label="Provider fee"
            value={formatMoney(providerFee)}
            hint="All provider charges, valued at mid"
          />
          <Field
            label="Platform fee"
            value={formatMoney(route.breakdown.platformFeeCost)}
            hint={
              route.breakdown.platformFeeCost.minorUnits === '0'
                ? 'No negotiated terms apply'
                : 'Meridian’s own charge, shown separately'
            }
          />
          <Field
            icon={<Clock className="size-3.5" aria-hidden />}
            label="Settlement time"
            value={formatSettlement(route.settlement.p50Seconds, route.settlement.businessDaysOnly)}
            hint={`95th percentile ${formatSettlement(
              route.settlement.p95Seconds,
              route.settlement.businessDaysOnly,
            )}`}
          />
          <Field
            label="Quote expires"
            value={route.quote.expiresAt === null ? 'Not stated' : timeOfDay(route.quote.expiresAt)}
            hint="Prices are indicative until then"
          />
          <Field
            icon={<ShieldCheck className="size-3.5" aria-hidden />}
            label="Reliability"
            value={formatReliability(route.reliabilityScore)}
            hint={`Route score ${route.score} / 100`}
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
            {showDetails ? 'Hide' : 'Show'} route details
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

function timeOfDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.toISOString().slice(11, 19)} UTC`;
}
