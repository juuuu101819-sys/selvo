'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/dashboard', label: 'Overview', exact: true },
  { href: '/dashboard/quotes', label: 'Quotes', exact: false },
  { href: '/dashboard/transactions', label: 'Transactions', exact: false },
  { href: '/dashboard/providers', label: 'Providers', exact: false },
  { href: '/dashboard/revenue', label: 'Revenue', exact: false },
  { href: '/dashboard/invoices', label: 'Invoices', exact: false },
  { href: '/dashboard/agents', label: 'Agents', exact: false },
  { href: '/dashboard/onboarding', label: 'Onboarding', exact: false },
  { href: '/dashboard/settings', label: 'Settings', exact: false },
] as const;

export function DashboardNav({ organizationName }: { organizationName: string }) {
  const pathname = usePathname();

  return (
    <div className="border-border/60 border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            Signed in to <span className="text-foreground font-medium">{organizationName}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/rails" />}>
              Multi-rail
            </Button>
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/stablecoins" />}
            >
              Stablecoins
            </Button>
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/defi" />}>
              DeFi
            </Button>
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
              Compare routes
            </Button>
            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
        <nav aria-label="Organization dashboard" className="-mx-1 overflow-x-auto">
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
                        ? 'bg-emerald-600 text-white'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {link.label}
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
