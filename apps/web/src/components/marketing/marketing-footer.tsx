import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { FooterColumns } from './footer-columns';

/**
 * Marketing footer: tagline, regulatory notice slot, disclosure, legal links.
 * Preserves the per-surface `notice` prop (regulatory anchor) from SiteFooter.
 */
export async function MarketingFooter({
  notice,
  extra,
}: {
  notice: ReactNode;
  extra?: ReactNode;
}) {
  const t = await getTranslations('footer');

  return (
    <footer className="border-border/60 relative z-10 border-t">
      <div className="text-muted-foreground mx-auto w-full max-w-6xl space-y-4 px-4 py-10 text-xs sm:px-6">
        <p className="text-foreground font-display text-sm font-semibold">{t('tagline')}</p>
        <p className="flex items-start gap-1.5">
          <ShieldCheck className="text-recommend mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{notice}</span>
        </p>
        <p className="leading-relaxed">{t('disclosure')}</p>
        <FooterColumns />
        {extra}
        <nav aria-label={t('legalNav')} className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
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
