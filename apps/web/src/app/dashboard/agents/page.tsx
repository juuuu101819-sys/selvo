import { AgentPaymentsExplorer } from '@/components/agent-payments-explorer';
import { SessionEnded } from '@/components/dashboard/states';
import { ErrorState } from '@/components/states';
import { fetchAgents, fetchMerchants, fetchPaymentPolicies } from '@/lib/api/client';
import { loadDashboardSession } from '@/lib/dashboard-auth';

export default async function DashboardAgentsPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const [agents, merchants, policies] = await Promise.all([
    fetchAgents(session.token),
    fetchMerchants(session.token),
    fetchPaymentPolicies(session.token),
  ]);
  if (!agents.ok) {
    return <ErrorState failure={agents.failure} />;
  }
  if (!merchants.ok) {
    return <ErrorState failure={merchants.failure} />;
  }
  if (!policies.ok) {
    return <ErrorState failure={policies.failure} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI agent payments</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Create a payment intent from an instruction, quote routes, authorize, and simulate.
          Completed means the sandbox simulator finished — funds never move.
        </p>
      </div>
      <AgentPaymentsExplorer
        agents={agents.data.agents}
        merchants={merchants.data.merchants}
        policies={policies.data.policies}
        signedIn
      />
    </div>
  );
}
