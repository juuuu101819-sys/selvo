import { getTranslations } from 'next-intl/server';
import { MarketingCard } from './marketing-card';

const STAT_KEYS = ['stat1', 'stat2', 'stat3', 'stat4'] as const;

export async function StatBand() {
  const t = await getTranslations('landing.stats');

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {STAT_KEYS.map((key) => (
        <MarketingCard key={key} className="text-center">
          <p className="font-display text-base font-semibold tracking-tight sm:text-lg">{t(key)}</p>
        </MarketingCard>
      ))}
    </div>
  );
}
