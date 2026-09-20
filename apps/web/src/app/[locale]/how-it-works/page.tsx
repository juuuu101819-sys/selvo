import { getTranslations } from 'next-intl/server';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageCta } from '@/components/marketing/page-cta';
import { PageHero } from '@/components/marketing/page-hero';
import { SectionShell } from '@/components/marketing/section-shell';

export default async function HowItWorksPage() {
  const t = await getTranslations('pages.howItWorks');
  const tHow = await getTranslations('landing.how');

  return (
    <MarketingPageShell noticeKey="howItWorksNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <SectionShell heading={tHow('heading')}>
        <HowItWorks />
      </SectionShell>
      <PageCta
        title={t('ctaTitle')}
        body={t('ctaBody')}
        primaryLabel={t('ctaPrimary')}
        primaryHref="/login"
        secondaryLabel={t('ctaSecondary')}
        secondaryHref="/graph"
      />
    </MarketingPageShell>
  );
}
