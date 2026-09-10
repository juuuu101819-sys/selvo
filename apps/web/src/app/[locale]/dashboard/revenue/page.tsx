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

  const report = result.data;
  const empty = report.summary.eventCount === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Revenue</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Multi-rail monetization for {session.me.organization.name}. Figures are quoted platform
          fees, not settlements. Provider cost, partner commission, gross profit and take rate use
          Decimal arithmetic. Another organization&apos;s events never enter these totals.
        </p>
      </div>
      {empty ? (
        <DashboardEmpty title="No quoted revenue yet">
          Compare a route while signed in, quote an agent payment, or load the sandbox demo tenant.
          The ledger records attributed fees only — funds never move.
        </DashboardEmpty>
      ) : (
        <RevenueReport report={report} />
      )}
    </div>
  );
}
