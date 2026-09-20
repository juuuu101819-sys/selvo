import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { FOOTER_COLUMNS } from './footer-columns-config';

type NavKey = Parameters<Awaited<ReturnType<typeof getTranslations<'nav'>>>>[0];

export async function FooterColumns() {
  const t = await getTranslations('nav');

  return (
    <nav
      aria-label={t('ariaLabel')}
      className="grid gap-8 border-border/40 border-t pt-8 sm:grid-cols-2 lg:grid-cols-5"
    >
      {FOOTER_COLUMNS.map((column) => (
        <div key={column.id} className="space-y-3">
          <p className="text-foreground text-xs font-semibold tracking-wide uppercase">
            {t(column.headingKey as NavKey)}
          </p>
          <ul className="space-y-2">
            {column.links.map((link) => (
              <li key={link.id}>
                <Link
                  href={link.href}
                  className="hover:text-foreground text-xs underline-offset-4 hover:underline"
                >
                  {t(link.labelKey as NavKey)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
