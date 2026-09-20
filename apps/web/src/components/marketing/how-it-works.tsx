import { getTranslations } from 'next-intl/server';
import { MarketingCard } from './marketing-card';

const STEPS = ['step1', 'step2', 'step3', 'step4'] as const;

export async function HowItWorks() {
  const t = await getTranslations('landing.how');

  return (
    <ol className="grid gap-4 sm:grid-cols-2">
      {STEPS.map((step, index) => (
        <MarketingCard key={step} className="space-y-2">
          <p className="text-primary font-mono text-xs tabular-nums">{String(index + 1).padStart(2, '0')}</p>
          <h3 className="text-base font-semibold">{t(`${step}.title`)}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">{t(`${step}.body`)}</p>
        </MarketingCard>
      ))}
    </ol>
  );
}
