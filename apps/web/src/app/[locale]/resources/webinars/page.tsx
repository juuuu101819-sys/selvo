import { getTranslations } from 'next-intl/server';
import { MarketingCard } from '@/components/marketing/marketing-card';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageHero } from '@/components/marketing/page-hero';

export default async function WebinarsPage() {
  const t = await getTranslations('pages.resourcesWebinars');

  return (
    <MarketingPageShell noticeKey="resourcesNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <MarketingCard className="space-y-2">
        <p className="text-muted-foreground font-mono text-[11px] uppercase">{t('placeholderDate')}</p>
        <h2 className="text-base font-semibold">{t('placeholderTitle')}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">{t('placeholderBody')}</p>
      </MarketingCard>
    </MarketingPageShell>
  );
}
