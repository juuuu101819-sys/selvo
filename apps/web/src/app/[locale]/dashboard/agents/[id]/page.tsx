import { getLocale, getTranslations } from 'next-intl/server';
import { AgentMetricsGrid } from '@/components/dashboard/agent-metrics';
import { AgentSubnav } from '@/components/dashboard/agent-subnav';
import { DashboardEmpty, SessionEnded } from '@/components/dashboard/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ErrorState } from '@/components/states';
import { ExecutionConsentForm } from '@/components/dashboard/execution-consent-form';
import { fetchDashboardAgent } from '@/lib/api/client';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { formatQuotedAmount, formatTimestamp } from '@/lib/format';

export default async function DashboardAgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const { id } = await params;
  const result = await fetchDashboardAgent(id, session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const t = await getTranslations('agents');
  const tDash = await getTranslations('dashboard');
  const locale = await getLocale();
  const detail = result.data;
  const summary = detail.summary;
  const spending = detail.spending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{summary.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('detailLede', {
            funds: detail.fundsMoved ? t('fundsMoved') : t('fundsNeverMoved'),
          })}
        </p>
      </div>
      <AgentSubnav agentId={id} agentName={summary.name} pathname={`/dashboard/agents/${id}`} />
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{summary.status}</Badge>
        <Badge variant="outline">{summary.agentId}</Badge>
      </div>
      <ExecutionConsentForm
        kind="agent"
        agentId={id}
        authorized={summary.executionAuthorized}
        agreementReference={summary.executionAgreementReference}
        canManage={session.me.role === 'owner' || session.me.role === 'admin'}
      />
      <AgentMetricsGrid summary={summary} />

      {spending === null ? (
        <DashboardEmpty title={t('noSpendingPolicy')}>{t('noSpendingPolicyBody')}</DashboardEmpty>
      ) : (
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('spendingLimits')}</CardTitle>
            <CardDescription>{t('spendingLimitsHint', { asset: spending.asset })}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground text-xs">{t('maxPerPayment')}</p>
              <p className="font-mono text-sm tabular-nums">
                {formatQuotedAmount(
                  spending.maxTransactionMinorUnits,
                  spending.asset,
                  spending.exponent,
                  locale,
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t('dailySpentLimit')}</p>
              <p className="font-mono text-sm tabular-nums">
                {formatQuotedAmount(
                  spending.dailySpentMinorUnits,
                  spending.asset,
                  spending.exponent,
                  locale,
                )}{' '}
                /{' '}
                {formatQuotedAmount(
                  spending.dailyLimitMinorUnits,
                  spending.asset,
                  spending.exponent,
                  locale,
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t('remainingToday')}</p>
              <p className="font-mono text-sm tabular-nums">
                {formatQuotedAmount(
                  spending.dailyRemainingMinorUnits,
                  spending.asset,
                  spending.exponent,
                  locale,
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t('preferredRoutes')}</CardTitle>
          <CardDescription>{t('preferredRoutesHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {detail.preferredRoutes.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noQuotedRoutes')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tDash('colProvider')}</TableHead>
                  <TableHead>{tDash('colRail')}</TableHead>
                  <TableHead>{t('colIntents')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.preferredRoutes.map((row) => (
                  <TableRow key={`${row.providerId}:${row.rail}`}>
                    <TableCell>{row.providerName}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.rail.replaceAll('_', ' ')}
                    </TableCell>
                    <TableCell className="tabular-nums">{row.intentCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t('policyViolations')}</CardTitle>
          <CardDescription>{t('violationsHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {detail.violations.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noPolicyDenials')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tDash('colWhen')}</TableHead>
                  <TableHead>{t('colRule')}</TableHead>
                  <TableHead>{t('colMessage')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.violations.map((row) => (
                  <TableRow key={row.eventId}>
                    <TableCell className="font-mono text-xs">
                      {formatTimestamp(row.occurredAt, locale)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.rule.replaceAll('_', ' ')}
                    </TableCell>
                    <TableCell className="text-sm">{row.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
