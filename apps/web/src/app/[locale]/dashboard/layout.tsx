import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { DashboardNav } from '@/components/dashboard/nav';
import { SessionEnded } from '@/components/dashboard/states';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { fetchMeta } from '@/lib/api/client';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const [session, meta] = await Promise.all([loadDashboardSession(), fetchMeta()]);
  const organizationName = session.ok ? session.me.organization.name : null;
  const tFooter = await getTranslations('footer');

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
      <SiteFooter notice={tFooter('dashboardNotice')} />
    </>
  );
}
