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

/**
 * The expiration state of one quote, as a live badge.
 *
 * Three visual states on purpose: a healthy countdown, an amber warning while the price is about to
 * go, and an unmissable expired marker. A static timestamp would make the customer do the
 * arithmetic themselves, at exactly the moment it matters.
 */
export function QuoteExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  const t = useTranslations('comparison');
  const expiry = useQuoteExpiry(expiresAt);

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
        <Badge className="gap-1 bg-amber-500 font-mono text-xs tabular-nums text-white hover:bg-amber-500">
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
