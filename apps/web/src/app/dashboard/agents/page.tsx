import Link from 'next/link';
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
import { fetchAgents, fetchDashboardAgents, fetchMerchants, fetchPaymentPolicies } from '@/lib/api/client';
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

  const rows = dashboard.data.agents;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI agent financial dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Quoted volume, fees, success rate, spending limits and policy denials for agents in{' '}
          {session.me.organization.name}. Completed means the sandbox simulator finished — funds
          never move, and Meridian never holds a key or generates a wallet.
        </p>
      </div>

      {rows.length === 0 ? (
        <DashboardEmpty title="No agents yet">
          Issue an agent from Settings or the agents API. Dashboard figures appear after the agent
          quotes or the sandbox demo tenant is loaded.
        </DashboardEmpty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Volume</TableHead>
              <TableHead>Transactions</TableHead>
              <TableHead>Average fee</TableHead>
              <TableHead>Success</TableHead>
              <TableHead>Daily spend</TableHead>
              <TableHead>Violations</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.agentId}>
                <TableCell>
                  <Link
                    href={`/dashboard/agents/${row.agentId}`}
                    className="font-medium text-emerald-700 hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="text-muted-foreground font-mono text-xs">{row.agentId}</p>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(row.paymentVolumeMinorUnits, row.currency, row.exponent)}
                </TableCell>
                <TableCell className="tabular-nums">{row.transactionCount}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {row.averageFeeBps === null ? '—' : formatBps(row.averageFeeBps, 2)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.routeSuccessRatePercent === null ? '—' : `${row.routeSuccessRatePercent}%`}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(row.dailySpentMinorUnits, row.currency, row.exponent)}
                  {row.dailyLimitMinorUnits === null
                    ? null
                    : ` / ${formatQuotedAmount(row.dailyLimitMinorUnits, row.currency, row.exponent)}`}
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
          <h2 className="text-lg font-semibold tracking-tight">Sandbox simulator</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Create a payment intent from natural language, quote routes, authorize, and simulate.
            The parser only interprets intent. This is not custody and not a wallet.
          </p>
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
