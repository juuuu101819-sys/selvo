import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { AgentPaymentsExplorer } from '@/components/agent-payments-explorer';
import { DashboardEmpty, SessionEnded } from '@/components/dashboard/states';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ErrorState } from '@/components/states';
import {
  fetchAgents,
  fetchDashboardAgents,
  fetchMerchants,
  fetchPaymentPolicies,
} from '@/lib/api/client';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { formatBps, formatQuotedAmount } from '@/lib/format';

export default async function DashboardAgentsPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const [dashboard, agents, merchants, policies] = await Promise.all([
    fetchDashboardAgents(session.token),
    fetchAgents(session.token),
    fetchMerchants(session.token),
    fetchPaymentPolicies(session.token),
  ]);
  if (!dashboard.ok) {
    return <ErrorState failure={dashboard.failure} />;
  }
  if (!agents.ok) {
    return <ErrorState failure={agents.failure} />;
  }
  if (!merchants.ok) {
    return <ErrorState failure={merchants.failure} />;
  }
  if (!policies.ok) {
    return <ErrorState failure={policies.failure} />;
  }

  const t = await getTranslations('agents');
  const tCommon = await getTranslations('common');
  const locale = await getLocale();
  const rows = dashboard.data.agents;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('dashTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('dashLede', { name: session.me.organization.name })}
        </p>
      </div>

      {rows.length === 0 ? (
        <DashboardEmpty title={t('noAgents')}>{t('noAgentsBody')}</DashboardEmpty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colAgent')}</TableHead>
              <TableHead>{t('colVolume')}</TableHead>
              <TableHead>{t('colTransactions')}</TableHead>
              <TableHead>{t('colAverageFee')}</TableHead>
              <TableHead>{t('colSuccess')}</TableHead>
              <TableHead>{t('colDailySpend')}</TableHead>
              <TableHead>{t('colViolations')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.agentId}>
                <TableCell>
                  <Link
                    href={`/dashboard/agents/${row.agentId}`}
                    className="text-primary font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="text-muted-foreground font-mono text-xs">{row.agentId}</p>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(
                    row.paymentVolumeMinorUnits,
                    row.currency,
                    row.exponent,
                    locale,
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{row.transactionCount}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {row.averageFeeBps === null
                    ? tCommon('emDash')
                    : formatBps(row.averageFeeBps, 2, locale)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.routeSuccessRatePercent === null
                    ? tCommon('emDash')
                    : `${row.routeSuccessRatePercent}%`}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(row.dailySpentMinorUnits, row.currency, row.exponent, locale)}
                  {row.dailyLimitMinorUnits === null
                    ? null
                    : ` / ${formatQuotedAmount(row.dailyLimitMinorUnits, row.currency, row.exponent, locale)}`}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{row.policyViolationCount}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t('simulator')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('simulatorLede')}</p>
        </div>
        <AgentPaymentsExplorer
          agents={agents.data.agents}
          merchants={merchants.data.merchants}
          policies={policies.data.policies}
          signedIn
        />
      </section>
    </div>
  );
}
