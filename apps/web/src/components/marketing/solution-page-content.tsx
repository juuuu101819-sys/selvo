import { getTranslations } from 'next-intl/server';
import { ContentSection } from './content-sections';
import { MarketingPageShell } from './marketing-page-shell';
import { PageCta } from './page-cta';
import { PageHero } from './page-hero';

type SolutionPageId =
  | 'solCrossBorder'
  | 'solTreasury'
  | 'solFintechs'
  | 'solPlatforms'
  | 'solEnterprises';

export async function SolutionPageContent({ pageId }: { pageId: SolutionPageId }) {
  const t = await getTranslations(`pages.${pageId}`);

  return (
    <MarketingPageShell noticeKey="marketingNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <ContentSection title={t('section1Title')} body={t('section1Body')} />
      <ContentSection title={t('section2Title')} body={t('section2Body')} />
      <ContentSection title={t('section3Title')} body={t('section3Body')} />
      <PageCta
        title={t('ctaTitle')}
        body={t('ctaBody')}
        primaryLabel={t('ctaPrimary')}
        primaryHref="/login"
        secondaryLabel={t('ctaSecondary')}
        secondaryHref="/developers"
      />
    </MarketingPageShell>
  );
}
