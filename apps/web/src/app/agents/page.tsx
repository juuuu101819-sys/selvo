import { ShieldCheck } from 'lucide-react';
import { AgentPaymentsExplorer } from '@/components/agent-payments-explorer';
import { SiteHeader } from '@/components/site-header';
import { fetchAgents, fetchMerchants, fetchMeta, fetchPaymentPolicies } from '@/lib/api/client';
import { readSessionToken } from '@/lib/session';

export default async function AgentsPage() {
  const token = await readSessionToken();
  const [meta, agents, merchants, policies] = await Promise.all([
    fetchMeta(),
    token === null
      ? Promise.resolve({ ok: false as const, data: undefined })
      : fetchAgents(token),
    token === null
      ? Promise.resolve({ ok: false as const, data: undefined })
      : fetchMerchants(token),
    token === null
      ? Promise.resolve({ ok: false as const, data: undefined })
      : fetchPaymentPolicies(token),
  ]);

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            AI agent payments
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Agents request a payment in natural language. Meridian interprets that into a structured
            intent, then the deterministic routing engine quotes and ranks rails. The parser never
            computes rates, fees, slippage or settlement amounts. The platform never custodies an
            external operating account and never moves funds.
          </p>
        </div>
        <AgentPaymentsExplorer
          agents={agents.ok ? agents.data.agents : []}
          merchants={merchants.ok ? merchants.data.merchants : []}
          policies={policies.ok ? policies.data.policies : []}
          signedIn={token !== null}
        />
      </main>
      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-6xl px-4 py-6 text-xs sm:px-6">
          <p className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Sandbox simulation only. SIMULATION_COMPLETED means the simulator finished. Wallet
              references are external handles; controlledByPlatform is always false.
            </span>
          </p>
        </div>
      </footer>
    </>
  );
}
