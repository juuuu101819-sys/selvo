import { getTranslations } from 'next-intl/server';
import { DashboardEmpty, SessionEnded } from '@/components/dashboard/states';
import { RevenueReport } from '@/components/dashboard/revenue-report';
import { ErrorState } from '@/components/states';
import { fetchDashboardRevenue } from '@/lib/api/client';
import { loadDashboardSession } from '@/lib/dashboard-auth';

export default async function DashboardRevenuePage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const result = await fetchDashboardRevenue(session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const t = await getTranslations('dashboard');
  const report = result.data;
  const empty = report.summary.eventCount === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('revenueTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('revenueLede', { name: session.me.organization.name })}
        </p>
      </div>
      {empty ? (
        <DashboardEmpty title={t('noRevenue')}>{t('noRevenueBody')}</DashboardEmpty>
      ) : (
        <RevenueReport report={report} />
      )}
    </div>
  );
}
