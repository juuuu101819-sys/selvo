import { getTranslations } from 'next-intl/server';
import { ContentSection } from '@/components/marketing/content-sections';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageHero } from '@/components/marketing/page-hero';

export default async function CareersPage() {
  const t = await getTranslations('pages.careers');

  return (
    <MarketingPageShell noticeKey="marketingNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <ContentSection title={t('whyTitle')} body={t('whyBody')} />
      <ContentSection title={t('rolesTitle')} body={t('rolesBody')} />
      <ContentSection title={t('workTitle')} body={t('workBody')} />
    </MarketingPageShell>
  );
}
