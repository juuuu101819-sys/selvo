import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export async function SiteFooter({
  notice,
  extra,
}: {
  notice: ReactNode;
  extra?: ReactNode;
}) {
  const t = await getTranslations('footer');

  return (
    <footer className="border-border/60 border-t">
      <div className="text-muted-foreground mx-auto w-full max-w-6xl space-y-3 px-4 py-6 text-xs sm:px-6">
        <p className="flex items-start gap-1.5">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{notice}</span>
        </p>
        {extra}
        <nav aria-label={t('legalNav')} className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/terms" className="hover:text-foreground underline-offset-4 hover:underline">
            {t('terms')}
          </Link>
          <Link href="/privacy" className="hover:text-foreground underline-offset-4 hover:underline">
            {t('privacy')}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
