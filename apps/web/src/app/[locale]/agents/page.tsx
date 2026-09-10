import { getTranslations } from 'next-intl/server';
import { AgentPaymentsExplorer } from '@/components/agent-payments-explorer';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { fetchAgents, fetchMerchants, fetchMeta, fetchPaymentPolicies } from '@/lib/api/client';
import { readSessionToken } from '@/lib/session';

export default async function AgentsPage() {
  const token = await readSessionToken();
  const t = await getTranslations('agents');
  const tFooter = await getTranslations('footer');
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
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('publicTitle')}</h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">{t('publicLede')}</p>
        </div>
        <AgentPaymentsExplorer
          agents={agents.ok ? agents.data.agents : []}
          merchants={merchants.ok ? merchants.data.merchants : []}
          policies={policies.ok ? policies.data.policies : []}
          signedIn={token !== null}
        />
      </main>
      <SiteFooter notice={tFooter('agentsNotice')} />
    </>
  );
}
