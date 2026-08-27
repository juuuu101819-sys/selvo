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

  const { metrics, charts } = result.data;
  const empty = metrics.quoteCount === 0 && metrics.successfulRouteRequests === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organization overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Figures below are computed from quotes and transaction requests stored for{' '}
          {session.me.organization.name}. Another organization&apos;s rows never enter these
          queries.
        </p>
      </div>
      {empty ? (
        <DashboardEmpty title="No quotes stored yet">
          Compare a route while signed in, or load the sandbox demo tenant, and the metrics and
          charts will fill from that stored data.
        </DashboardEmpty>
      ) : (
        <>
          <MetricsGrid metrics={metrics} />
          <DashboardCharts
            volumeByDay={charts.volumeByDay}
            costByDay={charts.costByDay}
            providers={charts.providers}
          />
        </>
      )}
    </div>
  );
}
