import { getLocale, getTranslations } from 'next-intl/server';
import { AgentPolicyForm } from '@/components/dashboard/agent-policy-form';
import { AgentSubnav } from '@/components/dashboard/agent-subnav';
import { SessionEnded } from '@/components/dashboard/states';
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
import { fetchDashboardAgent, fetchDashboardAgentPolicies } from '@/lib/api/client';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { formatTimestamp } from '@/lib/format';

export default async function DashboardAgentPoliciesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const { id } = await params;
  const [detail, controls] = await Promise.all([
    fetchDashboardAgent(id, session.token),
    fetchDashboardAgentPolicies(id, session.token),
  ]);
  if (!detail.ok) {
    return <ErrorState failure={detail.failure} />;
  }
  if (!controls.ok) {
    return <ErrorState failure={controls.failure} />;
  }

  const t = await getTranslations('agents');
  const tDash = await getTranslations('dashboard');
  const tCommon = await getTranslations('common');
  const locale = await getLocale();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('paymentPolicy')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('policyPageLede', { name: detail.data.summary.name })}
        </p>
      </div>
      <AgentSubnav
        agentId={id}
        agentName={detail.data.summary.name}
        pathname={`/dashboard/agents/${id}/policies`}
      />
      <AgentPolicyForm agentId={id} controls={controls.data} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">{t('policyViolations')}</h2>
        {controls.data.violations.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noPolicyDenialsAgent')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tDash('colWhen')}</TableHead>
                <TableHead>{t('colRule')}</TableHead>
                <TableHead>{t('colIntent')}</TableHead>
                <TableHead>{t('colMessage')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {controls.data.violations.map((row) => (
                <TableRow key={row.eventId}>
                  <TableCell className="font-mono text-xs">
                    {formatTimestamp(row.occurredAt, locale)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{row.rule.replaceAll('_', ' ')}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.paymentIntentId ?? tCommon('emDash')}
                  </TableCell>
                  <TableCell className="text-sm">{row.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
