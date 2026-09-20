import { getTranslations } from 'next-intl/server';
import { ContentSection } from '@/components/marketing/content-sections';
import { MarketingCard } from '@/components/marketing/marketing-card';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageHero } from '@/components/marketing/page-hero';

export default async function BrandPage() {
  const t = await getTranslations('pages.brand');

  return (
    <MarketingPageShell noticeKey="marketingNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <ContentSection title={t('logosTitle')} body={t('logosBody')} />
      <div className="grid gap-4 sm:grid-cols-3">
        {(['primary', 'accent', 'recommend'] as const).map((token) => (
          <MarketingCard key={token} className="space-y-3">
            <div
              className="h-16 rounded-lg border border-border/60"
              style={{
                background:
                  token === 'primary'
                    ? 'var(--primary)'
                    : token === 'accent'
                      ? 'var(--accent)'
                      : 'var(--recommend)',
              }}
            />
            <p className="text-sm font-medium">{t(`${token}Color`)}</p>
          </MarketingCard>
        ))}
      </div>
      <ContentSection title={t('typeTitle')} body={t('typeBody')} />
      <ContentSection title={t('usageTitle')} body={t('usageBody')} />
    </MarketingPageShell>
  );
}
