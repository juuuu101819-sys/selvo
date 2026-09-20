import { getTranslations } from 'next-intl/server';
import { ContentSection } from '@/components/marketing/content-sections';
import { MarketingCard } from '@/components/marketing/marketing-card';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageCta } from '@/components/marketing/page-cta';
import { PageHero } from '@/components/marketing/page-hero';
import { Badge } from '@/components/ui/badge';

const TIERS = ['sandbox', 'starter', 'growth', 'enterprise'] as const;

export default async function PricingPage() {
  const t = await getTranslations('pages.pricing');

  return (
    <MarketingPageShell noticeKey="marketingNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed">{t('note')}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => (
          <MarketingCard key={tier} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{t(`${tier}Name`)}</h2>
              <Badge variant="secondary" className="text-[10px] uppercase">
                {t('indicative')}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">{t(`${tier}Desc`)}</p>
          </MarketingCard>
        ))}
      </div>
      <ContentSection title={t('disclaimerTitle')} body={t('disclaimerBody')} />
      <PageCta
        title={t('ctaTitle')}
        body={t('ctaBody')}
        primaryLabel={t('ctaPrimary')}
        primaryHref="/login"
        secondaryLabel={t('ctaSecondary')}
        secondaryHref="/company/contact"
      />
    </MarketingPageShell>
  );
}
