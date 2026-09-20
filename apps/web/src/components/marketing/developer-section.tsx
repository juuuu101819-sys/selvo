import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { MarketingCard } from './marketing-card';

export async function DeveloperSection() {
  const t = await getTranslations('landing.dev');

  return (
    <MarketingCard className="grid gap-6 lg:grid-cols-2 lg:items-center">
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight">{t('heading')}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">{t('body')}</p>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/developers" />}>
          {t('cta')}
        </Button>
      </div>
      <pre className="border-border/60 bg-background/60 overflow-x-auto rounded-xl border p-4 font-mono text-xs leading-relaxed">
        <code>{t('codeSample')}</code>
      </pre>
    </MarketingCard>
  );
}
