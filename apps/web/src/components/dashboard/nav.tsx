'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { signOut } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/dashboard', labelKey: 'overview', exact: true },
  { href: '/dashboard/quotes', labelKey: 'quotes', exact: false },
  { href: '/dashboard/transactions', labelKey: 'transactions', exact: false },
  { href: '/dashboard/providers', labelKey: 'providers', exact: false },
  { href: '/dashboard/revenue', labelKey: 'revenue', exact: false },
  { href: '/dashboard/invoices', labelKey: 'invoices', exact: false },
  { href: '/dashboard/agents', labelKey: 'agents', exact: false },
  { href: '/dashboard/onboarding', labelKey: 'onboarding', exact: false },
  { href: '/dashboard/settings', labelKey: 'settings', exact: false },
] as const;

export function DashboardNav({ organizationName }: { organizationName: string }) {
  const pathname = usePathname();
  const t = useTranslations('dashboard');
  const tHeader = useTranslations('header');

  return (
    <div className="border-border/60 border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            {t.rich('signedInTo', {
              name: organizationName,
              org: (chunks) => <span className="text-foreground font-medium">{chunks}</span>,
            })}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/rails" />}>
              {tHeader('navRails')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/stablecoins" />}
            >
              {tHeader('navStablecoins')}
            </Button>
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/defi" />}>
              {tHeader('navDefi')}
            </Button>
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
              {t('compareRoutes')}
            </Button>
            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit">
                {t('signOut')}
              </Button>
            </form>
          </div>
        </div>
        <nav aria-label={t('navAria')} className="-mx-1 overflow-x-auto">
          <ul className="flex min-w-max gap-1">
            {LINKS.map((link) => {
              const current = link.exact
                ? pathname === link.href
                : pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium whitespace-nowrap',
                      current
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {t(link.labelKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
