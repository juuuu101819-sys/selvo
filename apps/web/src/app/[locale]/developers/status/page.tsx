import { getTranslations } from 'next-intl/server';
import { MarketingCard } from '@/components/marketing/marketing-card';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageHero } from '@/components/marketing/page-hero';
import { Badge } from '@/components/ui/badge';
import { fetchMeta } from '@/lib/api/client';

export default async function StatusPage() {
  const t = await getTranslations('pages.devStatus');
  const meta = await fetchMeta();

  return (
    <MarketingPageShell noticeKey="devDocsNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <MarketingCard className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t('apiLabel')}</span>
          <Badge variant={meta.ok ? 'recommend' : 'secondary'}>
            {meta.ok ? t('statusOperational') : t('statusUnavailable')}
          </Badge>
        </div>
        {meta.ok ? (
          <dl className="text-muted-foreground grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-foreground font-medium">{t('modeLabel')}</dt>
              <dd>{meta.data.mode}</dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">{t('engineLabel')}</dt>
              <dd>{meta.data.engineVersion}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">{t('unavailableBody')}</p>
        )}
      </MarketingCard>
    </MarketingPageShell>
  );
}
