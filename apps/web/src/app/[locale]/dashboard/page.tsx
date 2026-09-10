import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DashboardCharts } from '@/components/dashboard/charts';
import { MetricsGrid } from '@/components/dashboard/metrics-grid';
import { DashboardEmpty, SessionEnded } from '@/components/dashboard/states';
import { ErrorState } from '@/components/states';
import { fetchDashboardMetrics } from '@/lib/api/client';
import { loadDashboardSession } from '@/lib/dashboard-auth';

export default async function DashboardOverviewPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const result = await fetchDashboardMetrics(session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const t = await getTranslations('dashboard');
  const { metrics, charts } = result.data;
  const empty = metrics.quoteCount === 0 && metrics.successfulRouteRequests === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('overviewTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('overviewLede', { name: session.me.organization.name })}
        </p>
      </div>
      {empty ? (
        <DashboardEmpty title={t('noQuotesStored')}>{t('noQuotesStoredBody')}</DashboardEmpty>
      ) : (
        <>
          <MetricsGrid metrics={metrics} />
          <DashboardCharts
            volumeByDay={charts.volumeByDay}
            costByDay={charts.costByDay}
            providers={charts.providers}
          />
          <p className="text-muted-foreground text-sm">
            {t('revenueLinkLead')}{' '}
            <Link href="/dashboard/revenue" className="text-foreground underline underline-offset-4">
              {t('revenueLink')}
            </Link>
            {t('revenueLinkTrail')}
          </p>
        </>
      )}
    </div>
  );
}
