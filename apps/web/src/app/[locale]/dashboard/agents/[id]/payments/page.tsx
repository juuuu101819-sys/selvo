import { getLocale, getTranslations } from 'next-intl/server';
import { AgentSubnav } from '@/components/dashboard/agent-subnav';
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
import { fetchDashboardAgent, fetchDashboardAgentPayments } from '@/lib/api/client';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { formatBps, formatQuotedAmount, formatTimestamp } from '@/lib/format';

export default async function DashboardAgentPaymentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const { id } = await params;
  const [detail, history] = await Promise.all([
    fetchDashboardAgent(id, session.token),
    fetchDashboardAgentPayments(id, session.token),
  ]);
  if (!detail.ok) {
    return <ErrorState failure={detail.failure} />;
  }
  if (!history.ok) {
    return <ErrorState failure={history.failure} />;
  }

  const t = await getTranslations('agents');
  const tDash = await getTranslations('dashboard');
  const tCommon = await getTranslations('common');
  const locale = await getLocale();
  const payments = history.data.payments;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('paymentHistory')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('paymentHistoryLede', { name: detail.data.summary.name })}
        </p>
      </div>
      <AgentSubnav
        agentId={id}
        agentName={detail.data.summary.name}
        pathname={`/dashboard/agents/${id}/payments`}
      />
      {payments.length === 0 ? (
        <DashboardEmpty title={t('noPaymentIntents')}>{t('noPaymentIntentsBody')}</DashboardEmpty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tDash('colCreated')}</TableHead>
              <TableHead>{tDash('colStatus')}</TableHead>
              <TableHead>{tDash('colCorridor')}</TableHead>
              <TableHead>{tDash('colAmount')}</TableHead>
              <TableHead>{t('colFee')}</TableHead>
              <TableHead>{tDash('colProvider')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((intent) => {
              const selected =
                intent.quotedRoutes.find((route) => route.routeId === intent.selectedRouteId) ??
                intent.quotedRoutes.find((route) => route.recommended) ??
                intent.quotedRoutes[0] ??
                null;
              return (
                <TableRow key={intent.id}>
                  <TableCell className="font-mono text-xs">
                    {formatTimestamp(intent.createdAt, locale)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{intent.status.replaceAll('_', ' ')}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {intent.sourceAsset}→{intent.destinationAsset}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {formatQuotedAmount(
                      intent.amount.minorUnits,
                      intent.amount.asset,
                      intent.amount.exponent,
                      locale,
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {selected === undefined || selected === null
                      ? tCommon('emDash')
                      : formatBps(selected.totalCostBps, 2, locale)}
                  </TableCell>
                  <TableCell className="text-sm">{selected?.providerName ?? tCommon('emDash')}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
