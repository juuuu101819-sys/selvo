'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: (id: string) => `/dashboard/agents/${id}`, labelKey: 'agentOverview' as const, suffix: '' },
  {
    href: (id: string) => `/dashboard/agents/${id}/payments`,
    labelKey: 'agentPayments' as const,
    suffix: '/payments',
  },
  {
    href: (id: string) => `/dashboard/agents/${id}/policies`,
    labelKey: 'agentPolicies' as const,
    suffix: '/policies',
  },
] as const;

export function AgentSubnav({
  agentId,
  agentName,
  pathname,
}: {
  agentId: string;
  agentName: string;
  pathname: string;
}) {
  const t = useTranslations('dashboard');

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label={t('agentDashAria', { name: agentName })} className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1">
          {LINKS.map((link) => {
            const href = link.href(agentId);
            const current =
              link.suffix === ''
                ? pathname === href
                : pathname === href || pathname.endsWith(link.suffix);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium whitespace-nowrap',
                    current
                      ? 'bg-emerald-600 text-white'
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
      <Link
        href="/dashboard/agents"
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        {t('allAgents')}
      </Link>
    </div>
  );
}
