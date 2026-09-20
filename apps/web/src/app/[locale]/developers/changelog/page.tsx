import { getTranslations } from 'next-intl/server';
import { MarketingCard } from '@/components/marketing/marketing-card';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageHero } from '@/components/marketing/page-hero';

export default async function ChangelogPage() {
  const t = await getTranslations('pages.devChangelog');

  return (
    <MarketingPageShell noticeKey="devDocsNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <MarketingCard className="space-y-2">
        <p className="text-muted-foreground text-sm leading-relaxed">{t('emptyBody')}</p>
      </MarketingCard>
    </MarketingPageShell>
  );
}
