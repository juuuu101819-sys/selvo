'use client';

import { ChevronDown, Clock, Coins, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ContinueWithPartner } from '@/components/continue-with-partner';
import { CostBreakdown } from '@/components/cost-breakdown';
import { ProviderLicensingBadge } from '@/components/provider-licensing-badge';
import { QuoteExpiryBadge } from '@/components/quote-expiry';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { RouteDto } from '@/lib/api/types';
import {
  formatBps,
  formatMoney,
  formatPercent,
  formatRate,
  formatReliability,
} from '@/lib/format';
import { formatSettlementMessage } from '@/lib/format-i18n';

export function RouteCard({ route }: { route: RouteDto }) {
  const t = useTranslations('comparison');
  const tTime = useTranslations('time');
  const locale = useLocale();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const settlement = (seconds: number) =>
    formatSettlementMessage(tTime, seconds, route.settlement.businessDaysOnly);

  return (
    <article className="border-border bg-card rounded-xl border">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground font-mono text-xs">#{route.rank}</span>
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
                render={<p className="cursor-help text-2xl font-semibold tabular-nums" />}
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

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
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

        {Number(route.slippageBps) > 0 && (
          <p className="text-muted-foreground mt-3 text-xs">
            {t('slippageLine', { bps: formatBps(route.slippageBps, 1, locale) })}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <ScoreBar score={route.score} label={t('routeScoreAria')} />
            <ContinueWithPartner providerName={route.provider.name} variant="outline" />
          </div>
          <button
            type="button"
            onClick={() => setShowBreakdown((open) => !open)}
            aria-expanded={showBreakdown}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-colors"
          >
            {showBreakdown ? t('hideBreakdown') : t('showBreakdown')}
            <ChevronDown
              aria-hidden
              className={`size-3.5 transition-transform ${showBreakdown ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {showBreakdown && (
        <div className="border-border/60 border-t px-4 py-4 sm:px-5">
          <CostBreakdown route={route} />
        </div>
      )}
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
    <div className="min-w-0">
      <dt className="text-muted-foreground flex items-center gap-1 text-xs">
        {icon}
        {label}
      </dt>
      <dd
        className={`truncate tabular-nums ${emphasise ? 'font-semibold' : 'font-medium'}`}
        title={value}
      >
        {value}
      </dd>
      {hint !== undefined && <dd className="text-muted-foreground truncate text-xs">{hint}</dd>}
    </div>
  );
}

function ScoreBar({ score, label }: { score: string; label: string }) {
  const value = Math.max(0, Math.min(100, Number(score)));
  return (
    <div className="flex items-center gap-2">
      <div
        className="bg-muted h-1.5 w-24 overflow-hidden rounded-full"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-emerald-600 transition-[width]"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-muted-foreground font-mono text-xs tabular-nums">{score}</span>
    </div>
  );
}
