import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

export async function GradientCta() {
  const t = await getTranslations('landing.finalCta');

  return (
    <div
      className="marketing-surface relative overflow-hidden rounded-2xl border border-border/60 p-8 sm:p-10"
      style={{
        backgroundImage:
          'linear-gradient(135deg, color-mix(in oklch, var(--primary) 22%, transparent), color-mix(in oklch, var(--accent) 12%, transparent) 50%, color-mix(in oklch, var(--recommend) 10%, transparent))',
      }}
    >
      <div className="relative z-10 mx-auto max-w-2xl space-y-4 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">{t('body')}</p>
        <Button nativeButton={false} render={<Link href="/login" />}>
          {t('button')}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
