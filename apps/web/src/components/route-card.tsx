'use client';

import { ChevronDown, Clock, Coins, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ContinueWithPartner } from '@/components/continue-with-partner';
import { CostBreakdown } from '@/components/cost-breakdown';
import { ProviderLicensingBadge } from '@/components/provider-licensing-badge';
import { QuoteExpiryBadge } from '@/components/quote-expiry';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { displayBarPercentFromDecimal } from '@/lib/chart-display';
import type { RouteDto } from '@/lib/api/types';
import { formatBps, formatMoney, formatPercent, formatRate, formatReliability } from '@/lib/format';
import { formatSettlementMessage } from '@/lib/format-i18n';

export type RouteDimensionLeaders = {
  readonly lowestCostBps: string;
  readonly fastestP50: number;
  readonly highestReliability: string;
};

export function RouteCard({
  route,
  dimensionLeaders,
  maxCostBps,
  maxSettlementP50,
}: {
  route: RouteDto;
  dimensionLeaders: RouteDimensionLeaders;
  maxCostBps: string;
  maxSettlementP50: number;
}) {
  const t = useTranslations('comparison');
  const tTime = useTranslations('time');
  const locale = useLocale();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const settlement = (seconds: number) =>
    formatSettlementMessage(tTime, seconds, route.settlement.businessDaysOnly);

  const isBestCost = route.totalCostBps === dimensionLeaders.lowestCostBps;
  const isBestSpeed = route.settlement.p50Seconds === dimensionLeaders.fastestP50;
  const isBestReliability = route.reliabilityScore === dimensionLeaders.highestReliability;

  const toggleBreakdown = (): void => setShowBreakdown((open) => !open);

  const handleCardClick = (event: MouseEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest('a, button, [role="button"]')) {
      return;
    }
    toggleBreakdown();
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleBreakdown();
    }
  };

  return (
    <article
      className={cn(
        'border-border/70 bg-card/80 rounded-xl border shadow-sm transition-[box-shadow,background-color] duration-200',
        'hover:border-border hover:bg-card/90',
        showBreakdown && 'border-primary/25 shadow-[0_8px_28px_-18px] shadow-primary/25',
      )}
    >
      <div
        className="cursor-pointer p-4 sm:p-5"
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={showBreakdown}
        aria-controls={`route-breakdown-${route.routeId}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground font-mono text-xs tabular-nums">#{route.rank}</span>
              <h3 className="truncate text-base font-semibold">{route.provider.name}</h3>
              <Badge variant="outline" className="text-xs">
                {route.provider.railLabel}
              </Badge>
              <ProviderLicensingBadge licensing={route.provider.licensing} />
              <QuoteExpiryBadge expiresAt={route.quote.expiresAt} />
            </div>
            {route.quote.intermediaryAsset !== null && (
              <p className="text-muted-foreground text-xs">
                {t('middleLeg', { asset: route.quote.intermediaryAsset })}
              </p>
            )}
          </div>

          <div className="text-right">
            <Tooltip>
              <TooltipTrigger
                render={<p className="cursor-help text-xl font-semibold tabular-nums sm:text-2xl" />}
              >
                {formatPercent(route.totalCostPercent, 2, locale)}
              </TooltipTrigger>
              <TooltipContent>
                {t('allInAgainstMid', { bps: formatBps(route.totalCostBps, 2, locale) })}
              </TooltipContent>
            </Tooltip>
            <p className="text-muted-foreground text-xs">{t('totalCost')}</p>
          </div>
        </div>

        <Separator className="my-4" />

        <dl className="grid grid-cols-1 gap-x-4 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            icon={<Coins className="size-3.5" aria-hidden />}
            label={t('beneficiaryReceives')}
            value={formatMoney(route.deliveredAmount, locale)}
            emphasise
          />
          <Metric
            icon={<Clock className="size-3.5" aria-hidden />}
            label={t('settlement')}
            value={settlement(route.settlement.p50Seconds)}
            hint={tTime('p95', { value: settlement(route.settlement.p95Seconds) })}
          />
          <Metric
            label={t('allInRate')}
            value={`${formatRate(route.effectiveRate.value)} ${route.effectiveRate.pair}`}
            hint={t('midMarket', { rate: formatRate(route.midMarketRate.value) })}
          />
          <Metric
            icon={<ShieldCheck className="size-3.5" aria-hidden />}
            label={t('reliability')}
            value={formatReliability(route.reliabilityScore, locale)}
            hint={t('routeScore', { score: route.score })}
          />
        </dl>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <DimensionBar
            label={t('totalCost')}
            width={displayBarPercentFromDecimal(route.totalCostBps, maxCostBps)}
            highlight={isBestCost}
          />
          <DimensionBar
            label={t('settlement')}
            width={Math.max(
              8,
              Math.round((1 - route.settlement.p50Seconds / maxSettlementP50) * 100),
            )}
            highlight={isBestSpeed}
          />
          <DimensionBar
            label={t('reliability')}
            width={Math.max(8, Math.round(Number(route.reliabilityScore) * 100))}
            highlight={isBestReliability}
          />
        </div>

        {Number(route.slippageBps) > 0 && (
          <p className="text-muted-foreground mt-3 text-xs">
            {t('slippageLine', { bps: formatBps(route.slippageBps, 1, locale) })}
          </p>
        )}

        <p className="text-muted-foreground mt-4 inline-flex items-center gap-1 text-xs font-medium">
          {showBreakdown ? t('hideBreakdown') : t('showBreakdown')}
          <ChevronDown
            aria-hidden
            className={cn('size-3.5 transition-transform duration-300', showBreakdown && 'rotate-180')}
          />
        </p>
      </div>

      <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
        <ContinueWithPartner providerName={route.provider.name} variant="outline" />
      </div>

      <div
        id={`route-breakdown-${route.routeId}`}
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none',
          showBreakdown ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="border-border/60 border-t px-4 py-4 sm:px-5">
            <CostBreakdown route={route} />
          </div>
        </div>
      </div>
    </article>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
  emphasise = false,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  emphasise?: boolean;
}) {
  return (
    <div className="min-w-[8.75rem]">
      <dt className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs leading-snug">
        {icon}
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 break-words leading-snug tabular-nums',
          emphasise ? 'font-semibold' : 'font-medium',
        )}
      >
        {value}
      </dd>
      {hint !== undefined && (
        <dd className="text-muted-foreground mt-0.5 break-words text-xs leading-snug">{hint}</dd>
      )}
    </div>
  );
}

function DimensionBar({
  label,
  width,
  highlight,
}: {
  label: string;
  width: number;
  highlight: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground flex items-center justify-between text-[10px] uppercase tracking-wide">
        <span>{label}</span>
      </div>
      <div className="bg-muted/80 h-1 overflow-hidden rounded-full">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none',
            highlight ? 'bg-accent' : 'bg-primary/70',
          )}
          style={{ width: `${Math.min(100, Math.max(0, width))}%` }}
          role="presentation"
        />
      </div>
    </div>
  );
}
