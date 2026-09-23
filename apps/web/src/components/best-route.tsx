'use client';

import { ChevronDown, Clock, ShieldCheck, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ContinueWithPartner } from '@/components/continue-with-partner';
import { CostBreakdown } from '@/components/cost-breakdown';
import { ProviderLicensingBadge } from '@/components/provider-licensing-badge';
import { QuoteExpiryBadge, SHORT_VALIDITY_HINT_THRESHOLD_MS } from '@/components/quote-expiry';
import { RouteScoreHint } from '@/components/route-card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { MoneyJson, RouteDto } from '@/lib/api/types';
import { formatMoney, formatPercent, formatRate, formatReliability } from '@/lib/format';
import { formatSettlementMessage } from '@/lib/format-i18n';

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

function lerpMinorUnits(from: string, to: string, progress: number): string {
  const start = BigInt(from);
  const end = BigInt(to);
  const delta = end - start;
  const scaled = BigInt(Math.round(Number(delta) * progress));
  return (start + scaled).toString();
}

function AnimatedDeliveredAmount({ money, locale }: { money: MoneyJson; locale: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const previousMinorRef = useRef(money.minorUnits);
  const [displayMinor, setDisplayMinor] = useState(money.minorUnits);

  useEffect(() => {
    if (reducedMotion) {
      setDisplayMinor(money.minorUnits);
      previousMinorRef.current = money.minorUnits;
      return;
    }

    const from = previousMinorRef.current;
    const to = money.minorUnits;
    if (from === to) {
      return;
    }

    const started = performance.now();
    const durationMs = 650;
    let frame = 0;

    const tick = (now: number): void => {
      const progress = Math.min(1, (now - started) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setDisplayMinor(lerpMinorUnits(from, to, eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        previousMinorRef.current = to;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [money.minorUnits, money.currency, money.exponent, reducedMotion]);

  return (
    <p className="font-display text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
      {formatMoney({ ...money, minorUnits: displayMinor }, locale)}
    </p>
  );
}

/**
 * The answer, given the prominence of one.
 */
export function BestRoute({
  route,
  crownFlash = false,
}: {
  route: RouteDto;
  crownFlash?: boolean;
}) {
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
      className={cn(
        'marketing-surface relative overflow-hidden rounded-2xl transition-[box-shadow,ring-color] duration-700',
        'shadow-[0_4px_28px_-6px] shadow-primary/30,0_24px_50px_-30px_rgba(0,0,0,0.75)',
        crownFlash &&
          'ring-accent/70 shadow-[0_0_0_1px] shadow-accent/40 ring-2 ring-accent/60',
      )}
    >
      <div className="from-primary/10 pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent opacity-80" />
      <div className="relative p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-accent text-xs font-semibold tracking-widest uppercase">
              {t('bestRoute')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold sm:text-2xl">{route.provider.name}</h2>
              <Badge variant="outline" className="text-xs">
                {route.provider.railLabel}
              </Badge>
              <ProviderLicensingBadge licensing={route.provider.licensing} />
              <Badge variant="accent" className="text-xs">
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
          <QuoteExpiryBadge
            expiresAt={route.quote.expiresAt}
            shortValidityThresholdMs={SHORT_VALIDITY_HINT_THRESHOLD_MS}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t('beneficiaryReceives')}
            </p>
            <AnimatedDeliveredAmount money={route.deliveredAmount} locale={locale} />
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

        <dl className="grid grid-cols-1 gap-x-4 gap-y-4 text-sm sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
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
            hint={<RouteScoreHint score={route.score} />}
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
              className={`size-3.5 transition-transform duration-300 ${showDetails ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none',
          showDetails ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="border-border/60 border-t px-4 py-4 sm:px-6">
            <CostBreakdown route={route} />
          </div>
        </div>
      </div>
    </article>
  );
}

function Field({
  icon,
  label,
  value,
  hint,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-[8.75rem]">
      <dt className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs leading-snug">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 font-medium break-words leading-snug tabular-nums">{value}</dd>
      {hint !== undefined && (
        <dd className="text-muted-foreground mt-0.5 break-words text-xs leading-snug">{hint}</dd>
      )}
    </div>
  );
}

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
