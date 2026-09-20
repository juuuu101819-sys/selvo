import { getTranslations } from 'next-intl/server';
import { FeatureCard } from './feature-card';
import { SectionShell } from './section-shell';

const FEATURES = ['item1', 'item2', 'item3', 'item4', 'item5', 'item6'] as const;

export async function FeaturesSection() {
  const t = await getTranslations('landing.features');

  return (
    <SectionShell heading={t('heading')}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((key) => (
          <FeatureCard key={key} title={t(`${key}.title`)} body={t(`${key}.body`)} />
        ))}
      </div>
    </SectionShell>
  );
}
