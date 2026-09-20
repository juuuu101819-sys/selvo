import { getTranslations } from 'next-intl/server';
import { ContentSection } from '@/components/marketing/content-sections';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageHero } from '@/components/marketing/page-hero';

export default async function SdksPage() {
  const t = await getTranslations('pages.devSdks');

  return (
    <MarketingPageShell noticeKey="devDocsNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <ContentSection
        title={t('listTitle')}
        items={[
          { title: t('sdk1Title'), body: t('sdk1Body') },
          { title: t('sdk2Title'), body: t('sdk2Body') },
          { title: t('sdk3Title'), body: t('sdk3Body') },
        ]}
      />
    </MarketingPageShell>
  );
}
