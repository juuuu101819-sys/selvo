import { getTranslations } from 'next-intl/server';
import { MarketingCard } from './marketing-card';
import { SectionShell } from './section-shell';

const PILLARS = ['discover', 'decide', 'coordinate'] as const;

export async function ModelSection() {
  const t = await getTranslations('landing.model');

  return (
    <SectionShell heading={t('heading')} subheading={t('sub')}>
      <div className="grid gap-4 lg:grid-cols-3">
        {PILLARS.map((pillar) => (
          <MarketingCard key={pillar} className="space-y-3">
            <h3 className="text-lg font-semibold">{t(`${pillar}.title`)}</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">{t(`${pillar}.body`)}</p>
            <ul className="text-muted-foreground space-y-1 text-xs">
              <li>{t(`${pillar}.bullet1`)}</li>
              <li>{t(`${pillar}.bullet2`)}</li>
              <li>{t(`${pillar}.bullet3`)}</li>
            </ul>
          </MarketingCard>
        ))}
      </div>
    </SectionShell>
  );
}
