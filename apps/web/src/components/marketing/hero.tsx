import { ArrowRight, BookOpen } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

export async function Hero() {
  const t = await getTranslations('landing');

  return (
    <div className="space-y-6">
      <p className="text-accent text-xs font-semibold tracking-widest uppercase">{t('eyebrow')}</p>
      <h1 className="max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
        {t('title')}
      </h1>
      <p className="text-muted-foreground max-w-xl text-sm leading-relaxed sm:text-base">{t('lede')}</p>
      <div className="flex flex-wrap gap-3">
        <Button nativeButton={false} render={<Link href="/login" />}>
          {t('ctaPrimary')}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/developers" />}>
          <BookOpen className="size-4" aria-hidden />
          {t('ctaSecondary')}
        </Button>
      </div>
      <p className="text-muted-foreground max-w-lg text-xs leading-relaxed">{t('noncustodialNote')}</p>
    </div>
  );
}
