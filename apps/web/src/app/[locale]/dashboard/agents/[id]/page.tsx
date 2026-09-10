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

  const detail = result.data;
  const summary = detail.summary;
  const spending = detail.spending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{summary.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Financial activity for this agent. Quoted and simulated only —{' '}
          {detail.fundsMoved ? 'funds moved' : 'funds never moved'}, custody is off, no wallets
          generated, no private keys held.
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
        <DashboardEmpty title="No spending policy">
          This agent has no fail-closed policy yet. Limits appear here once a policy exists.
        </DashboardEmpty>
      ) : (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Spending limits</CardTitle>
            <CardDescription>
              Daily cap in {spending.asset}. Remaining is limit minus completed and authorized
              simulations today (UTC).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground text-xs">Max per payment</p>
              <p className="font-mono text-sm tabular-nums">
                {formatQuotedAmount(
                  spending.maxTransactionMinorUnits,
                  spending.asset,
                  spending.exponent,
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Daily spent / limit</p>
              <p className="font-mono text-sm tabular-nums">
                {formatQuotedAmount(
                  spending.dailySpentMinorUnits,
                  spending.asset,
                  spending.exponent,
                )}{' '}
                /{' '}
                {formatQuotedAmount(
                  spending.dailyLimitMinorUnits,
                  spending.asset,
                  spending.exponent,
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Remaining today</p>
              <p className="font-mono text-sm tabular-nums">
                {formatQuotedAmount(
                  spending.dailyRemainingMinorUnits,
                  spending.asset,
                  spending.exponent,
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card size="sm">
        <CardHeader>
          <CardTitle>Preferred routes</CardTitle>
          <CardDescription>
            Selected, recommended or first quoted provider per intent. Ranked by count.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.preferredRoutes.length === 0 ? (
            <p className="text-muted-foreground text-sm">No quoted routes yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Rail</TableHead>
                  <TableHead>Intents</TableHead>
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
          <CardTitle>Policy violations</CardTitle>
          <CardDescription>Fail-closed denials scoped to this agent.</CardDescription>
        </CardHeader>
        <CardContent>
          {detail.violations.length === 0 ? (
            <p className="text-muted-foreground text-sm">No policy denials recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.violations.map((row) => (
                  <TableRow key={row.eventId}>
                    <TableCell className="font-mono text-xs">
                      {formatTimestamp(row.occurredAt)}
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
