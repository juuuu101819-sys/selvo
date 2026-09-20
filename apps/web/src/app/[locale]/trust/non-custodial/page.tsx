import { getTranslations } from 'next-intl/server';
import { BulletSection, ContentSection } from '@/components/marketing/content-sections';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageCta } from '@/components/marketing/page-cta';
import { PageHero } from '@/components/marketing/page-hero';

export default async function NonCustodialPage() {
  const t = await getTranslations('pages.trustNonCustodial');

  return (
    <MarketingPageShell noticeKey="trustNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <ContentSection
        title={t('doesTitle')}
        items={[
          { title: t('does1Title'), body: t('does1Body') },
          { title: t('does2Title'), body: t('does2Body') },
          { title: t('does3Title'), body: t('does3Body') },
        ]}
      />
      <BulletSection
        title={t('neverTitle')}
        items={[t('never1'), t('never2'), t('never3'), t('never4'), t('never5')]}
      />
      <ContentSection title={t('boundaryTitle')} body={t('boundaryBody')} />
      <ContentSection title={t('signatureTitle')} body={t('signatureBody')} />
      <PageCta
        title={t('ctaTitle')}
        body={t('ctaBody')}
        primaryLabel={t('ctaPrimary')}
        primaryHref="/how-it-works"
        secondaryLabel={t('ctaSecondary')}
        secondaryHref="/graph"
      />
    </MarketingPageShell>
  );
}
