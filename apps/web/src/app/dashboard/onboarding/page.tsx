import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { DashboardEmpty, SessionEnded } from '@/components/dashboard/states';
import { ErrorState } from '@/components/states';
import { fetchDashboardOnboarding } from '@/lib/api/client';
import type { KybStatusDto, OnboardingSnapshotDto, OnboardingStepDto } from '@/lib/api/types';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { KybSubmitForm } from './kyb-submit';

const KYB_LABEL: Record<KybStatusDto, string> = {
  unverified: 'Unverified',
  pending: 'Pending manual review',
  verified: 'Verified',
  rejected: 'Rejected',
};

function stepBadge(step: OnboardingStepDto) {
  if (step.complete) {
    return <Badge>Complete</Badge>;
  }
  if (step.id === 'kyb' && step.status === 'rejected') {
    return <Badge variant="destructive">Rejected</Badge>;
  }
  if (step.id === 'kyb' && step.status === 'pending') {
    return <Badge variant="secondary">Pending review</Badge>;
  }
  return <Badge variant="outline">Incomplete</Badge>;
}

function stepDetail(snapshot: OnboardingSnapshotDto, step: OnboardingStepDto): string {
  switch (step.id) {
    case 'organization':
      return `Tenant ${snapshot.organizationId} exists. New organizations start with no elevated scopes.`;
    case 'kyb':
      if (snapshot.kybStatus === 'rejected' && snapshot.kybReason !== null) {
        return `Rejected: ${snapshot.kybReason}`;
      }
      if (snapshot.kybStatus === 'pending') {
        return 'Submitted for manual review. A vendor timeout or error never auto-approves.';
      }
      if (snapshot.kybStatus === 'verified') {
        return snapshot.kybReason ?? 'Manual review recorded a verified decision.';
      }
      return 'Not submitted. Sandbox quotes stay available; licensed quotes stay blocked.';
    case 'pricing':
      return snapshot.pricingConfigured
        ? 'An explicit CustomerPricing rule is in force. Zero take-rate counts only when that row exists.'
        : 'No CustomerPricing row. There is no silent default take-rate.';
    case 'api_key':
      return snapshot.apiKeyIssued
        ? 'At least one unrevoked organization API key exists. Issue further keys from Settings.'
        : 'No API key yet. Owners and admins issue keys from Settings after the rest of onboarding.';
    default:
      return '';
  }
}

export default async function DashboardOnboardingPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const result = await fetchDashboardOnboarding(session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const snapshot = result.data;
  const completed = snapshot.steps.filter((step) => step.complete).length;
  const total = snapshot.steps.length;
  const canSubmitKyb =
    (session.me.role === 'owner' || session.me.role === 'admin') && snapshot.kybStatus === 'unverified';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organization onboarding</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sales-assisted, invite-only. Each step below is the live backend state for{' '}
          {session.me.organization.name} — not a preview of work that has not happened.
        </p>
      </div>

      <Alert>
        <AlertTitle>
          {snapshot.realTransactionEligible
            ? 'KYB and contracted pricing are complete'
            : 'Not eligible for licensed quotes'}
        </AlertTitle>
        <AlertDescription>
          {snapshot.realTransactionEligible
            ? 'This organization may receive licensed-provider quotes once a partner of record exists. Execution stays unimplemented (POST /api/v1/executions → 501). Customer funds never touch Meridian.'
            : 'Sandbox and demo quotes are available for exploration. Licensed-provider quotes and any future execution require verified KYB and an explicit CustomerPricing rule. Onboarding itself does not enable execution.'}
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          Checklist · {completed} of {total} complete
        </p>
        <Progress value={(completed / total) * 100} />
      </div>

      <ul className="grid gap-3">
        {snapshot.steps.map((step) => (
          <li key={step.id}>
            <Card size="sm">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>{step.label}</CardTitle>
                  <CardDescription>{stepDetail(snapshot, step)}</CardDescription>
                </div>
                {stepBadge(step)}
              </CardHeader>
              {step.id === 'kyb' && canSubmitKyb ? (
                <CardContent>
                  <KybSubmitForm />
                </CardContent>
              ) : null}
              {step.id === 'api_key' && !snapshot.apiKeyIssued ? (
                <CardContent>
                  <Link
                    href="/dashboard/settings"
                    className="text-foreground text-sm underline underline-offset-4"
                  >
                    Open settings to issue an API key
                  </Link>
                </CardContent>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>

      <dl className="text-muted-foreground grid gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt>Onboarding mode</dt>
          <dd className="text-foreground font-mono">{snapshot.mode}</dd>
        </div>
        <div>
          <dt>KYB vendor</dt>
          <dd className="text-foreground font-mono">
            {snapshot.kybVendor} · {KYB_LABEL[snapshot.kybStatus]}
          </dd>
        </div>
        <div>
          <dt>Pricing model</dt>
          <dd className="text-foreground font-mono">{snapshot.pricingModel}</dd>
        </div>
        <div>
          <dt>Licensed provider configured</dt>
          <dd className="text-foreground">{snapshot.licensedProviderConfigured ? 'yes' : 'no'}</dd>
        </div>
      </dl>

      {!snapshot.licensedProviderConfigured ? (
        <DashboardEmpty title="Licensed quoting is still blocked at the platform">
          PHASE 30 has no named licensed partner of record. Completing this checklist does not
          invent one, and it does not turn executions on.
        </DashboardEmpty>
      ) : null}
    </div>
  );
}
