import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { MarketingCard } from './marketing-card';

const RAILS = [
  { key: 'tradfi', tagKey: 'tagSandbox' as const },
  { key: 'stablecoin', tagKey: 'tagSandbox' as const },
  { key: 'defi', tagKey: 'tagSandbox' as const },
  { key: 'liquidity', tagKey: 'tagSandbox' as const },
  { key: 'tokenized', tagKey: 'tagPartnerRequired' as const },
  { key: 'treasury', tagKey: 'tagPlanned' as const },
] as const;

export async function RailGrid() {
  const t = await getTranslations('landing.rails');

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {RAILS.map(({ key, tagKey }) => (
        <MarketingCard key={key} className="marketing-surface-rail space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{t(`${key}.title`)}</h3>
            <Badge
              variant={
                tagKey === 'tagSandbox'
                  ? 'recommend'
                  : tagKey === 'tagPartnerRequired'
                    ? 'outline'
                    : 'secondary'
              }
              className="text-[10px] uppercase"
            >
              {t(tagKey)}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">{t(`${key}.body`)}</p>
        </MarketingCard>
      ))}
    </div>
  );
}
