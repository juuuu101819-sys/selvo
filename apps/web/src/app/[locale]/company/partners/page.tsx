import { getTranslations } from 'next-intl/server';
import { ContentSection } from '@/components/marketing/content-sections';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageCta } from '@/components/marketing/page-cta';
import { PageHero } from '@/components/marketing/page-hero';

export default async function PartnersPage() {
  const t = await getTranslations('pages.partners');

  return (
    <MarketingPageShell noticeKey="marketingNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <ContentSection
        title={t('typesTitle')}
        items={[
          { title: t('type1Title'), body: t('type1Body') },
          { title: t('type2Title'), body: t('type2Body') },
          { title: t('type3Title'), body: t('type3Body') },
          { title: t('type4Title'), body: t('type4Body') },
          { title: t('type5Title'), body: t('type5Body') },
        ]}
      />
      <ContentSection title={t('integrationTitle')} body={t('integrationBody')} />
      <PageCta
        title={t('ctaTitle')}
        body={t('ctaBody')}
        primaryLabel={t('ctaPrimary')}
        primaryHref="/company/contact"
      />
    </MarketingPageShell>
  );
}
