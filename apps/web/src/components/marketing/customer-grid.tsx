import { getTranslations } from 'next-intl/server';
import { MarketingCard } from './marketing-card';

const CUSTOMERS = ['fintechs', 'platforms', 'enterprises'] as const;

export async function CustomerGrid() {
  const t = await getTranslations('landing.customers');

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {CUSTOMERS.map((key) => (
        <MarketingCard key={key} className="space-y-2">
          <h3 className="text-base font-semibold">{t(`${key}.title`)}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">{t(`${key}.body`)}</p>
        </MarketingCard>
      ))}
    </div>
  );
}
