import { getTranslations } from 'next-intl/server';
import { ContentSection } from '@/components/marketing/content-sections';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageHero } from '@/components/marketing/page-hero';

export default async function AboutPage() {
  const t = await getTranslations('pages.about');

  return (
    <MarketingPageShell noticeKey="marketingNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <ContentSection title={t('missionTitle')} body={t('missionBody')} />
      <ContentSection
        title={t('principlesTitle')}
        items={[
          { title: t('principle1Title'), body: t('principle1Body') },
          { title: t('principle2Title'), body: t('principle2Body') },
          { title: t('principle3Title'), body: t('principle3Body') },
        ]}
      />
      <ContentSection title={t('teamTitle')} body={t('teamBody')} />
    </MarketingPageShell>
  );
}
