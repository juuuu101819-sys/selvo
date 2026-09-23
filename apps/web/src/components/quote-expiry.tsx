'use client';

import { Clock3, TimerOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { classifyQuoteExpiry, formatRemaining, type QuoteExpiryState } from '@/lib/quote-expiry';

/**
 * A once-a-second clock, shared by everything that renders a countdown.
 *
 * State lives here and not in the formatting logic, so the expiry rules stay pure functions and the
 * component layer is reduced to a tick plus markup.
 */
export function useNow(tickMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);

  return now;
}

export function useQuoteExpiry(expiresAt: string | null): QuoteExpiryState {
  const now = useNow();
  return classifyQuoteExpiry(expiresAt, now);
}

/** Best-route hint when remaining validity is shorter than a comfortable refresh window. */
export const SHORT_VALIDITY_HINT_THRESHOLD_MS = 60_000;

/**
 * The expiration state of one quote, as a live badge.
 *
 * Three visual states on purpose: a healthy countdown, a warning while the price is about to go,
 * and an unmissable expired marker. A static timestamp would make the customer do the arithmetic
 * themselves, at exactly the moment it matters.
 */
export function QuoteExpiryBadge({
  expiresAt,
  shortValidityThresholdMs,
}: {
  expiresAt: string | null;
  /** When set, live/expiring quotes below this remaining ms show a neutral short-validity hint. */
  shortValidityThresholdMs?: number;
}) {
  const t = useTranslations('comparison');
  const expiry = useQuoteExpiry(expiresAt);

  if (
    shortValidityThresholdMs !== undefined &&
    (expiry.state === 'live' || expiry.state === 'expiring') &&
    expiry.remainingMs < shortValidityThresholdMs
  ) {
    return (
      <Badge variant="secondary" className="gap-1 text-xs font-normal">
        <Clock3 className="size-3 shrink-0" aria-hidden />
        {t('shortValidityHint')}
        <span className="sr-only">
          {expiry.state === 'expiring'
            ? t('expiresIn', { remaining: formatRemaining(expiry.remainingMs) })
            : t('quoteValid', { remaining: formatRemaining(expiry.remainingMs) })}
        </span>
      </Badge>
    );
  }

  switch (expiry.state) {
    case 'no_expiry':
      return null;
    case 'live':
      return (
        <Badge variant="outline" className="gap-1 font-mono text-xs tabular-nums">
          <Clock3 className="size-3" aria-hidden />
          {t('quoteValid', { remaining: formatRemaining(expiry.remainingMs) })}
        </Badge>
      );
    case 'expiring':
      return (
        <Badge variant="warning" className="gap-1 font-mono text-xs tabular-nums">
          <Clock3 className="size-3" aria-hidden />
          {t('expiresIn', { remaining: formatRemaining(expiry.remainingMs) })}
        </Badge>
      );
    case 'expired':
      return (
        <Badge variant="destructive" className="gap-1 text-xs">
          <TimerOff className="size-3" aria-hidden />
          {t('quoteExpired')}
        </Badge>
      );
  }
}
