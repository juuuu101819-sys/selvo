import { getTranslations } from 'next-intl/server';
import { ContentSection } from '@/components/marketing/content-sections';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageHero } from '@/components/marketing/page-hero';

export default async function SecurityPage() {
  const t = await getTranslations('pages.trustSecurity');

  return (
    <MarketingPageShell noticeKey="trustNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <ContentSection title={t('section1Title')} body={t('section1Body')} />
      <ContentSection title={t('section2Title')} body={t('section2Body')} />
      <ContentSection title={t('section3Title')} body={t('section3Body')} />
    </MarketingPageShell>
  );
}
