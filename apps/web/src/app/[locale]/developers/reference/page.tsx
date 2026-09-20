import { getTranslations } from 'next-intl/server';
import { ContentSection } from '@/components/marketing/content-sections';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageHero } from '@/components/marketing/page-hero';
import { Button } from '@/components/ui/button';
import { resolveOpenapiHref } from '@/lib/openapi-url';

export default async function ApiReferencePage() {
  const t = await getTranslations('pages.devReference');
  const openapiHref = resolveOpenapiHref();

  return (
    <MarketingPageShell noticeKey="devDocsNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <ContentSection title={t('sectionTitle')} body={t('sectionBody')} />
      <Button nativeButton={false} render={<a href={openapiHref} target="_blank" rel="noopener noreferrer" />}>
        {t('openapiLink')}
      </Button>
    </MarketingPageShell>
  );
}
