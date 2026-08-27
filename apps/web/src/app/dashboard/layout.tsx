import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { DashboardNav } from '@/components/dashboard/nav';
import { SessionEnded } from '@/components/dashboard/states';
import { SiteHeader } from '@/components/site-header';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { fetchMeta } from '@/lib/api/client';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const [session, meta] = await Promise.all([loadDashboardSession(), fetchMeta()]);
  const organizationName = session.ok ? session.me.organization.name : null;

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
        organizationName={organizationName}
        authLinks="none"
      />
      {session.ok ? <DashboardNav organizationName={session.me.organization.name} /> : null}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {session.ok ? children : <SessionEnded failure={session.failure} />}
      </main>
      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-6xl px-4 py-6 text-xs sm:px-6">
          <p className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Meridian is non-custodial. The dashboard reports stored quotes and never holds
              customer funds, executes transactions, or issues stablecoins.
            </span>
          </p>
        </div>
      </footer>
    </>
  );
}
