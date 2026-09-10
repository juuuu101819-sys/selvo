import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: (id: string) => `/dashboard/agents/${id}`, label: 'Overview', suffix: '' },
  { href: (id: string) => `/dashboard/agents/${id}/payments`, label: 'Payments', suffix: '/payments' },
  { href: (id: string) => `/dashboard/agents/${id}/policies`, label: 'Policies', suffix: '/policies' },
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
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label={`${agentName} dashboard`} className="-mx-1 overflow-x-auto">
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
                  {link.label}
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
        All agents
      </Link>
    </div>
  );
}
