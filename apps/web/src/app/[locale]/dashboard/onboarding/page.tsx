import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
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
import type { KybStatusDto, OnboardingStepDto } from '@/lib/api/types';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { KybSubmitForm } from './kyb-submit';

function kybStatusKey(status: KybStatusDto): 'kybUnverified' | 'kybPending' | 'kybVerified' | 'kybRejected' {
  switch (status) {
    case 'pending':
      return 'kybPending';
    case 'verified':
      return 'kybVerified';
    case 'rejected':
      return 'kybRejected';
    default:
      return 'kybUnverified';
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

  const t = await getTranslations('onboarding');
  const tCommon = await getTranslations('common');
  const snapshot = result.data;
  const completed = snapshot.steps.filter((step) => step.complete).length;
  const total = snapshot.steps.length;
  const canSubmitKyb =
    (session.me.role === 'owner' || session.me.role === 'admin') && snapshot.kybStatus === 'unverified';

  const stepBadge = (step: OnboardingStepDto) => {
    if (step.complete) {
      return <Badge>{t('complete')}</Badge>;
    }
    if (step.id === 'kyb' && step.status === 'rejected') {
      return <Badge variant="destructive">{t('rejected')}</Badge>;
    }
    if (step.id === 'kyb' && step.status === 'pending') {
      return <Badge variant="secondary">{t('pendingReview')}</Badge>;
    }
    return <Badge variant="outline">{t('incomplete')}</Badge>;
  };

  const stepDetail = (step: OnboardingStepDto): string => {
    switch (step.id) {
      case 'organization':
        return t('orgExists', { id: snapshot.organizationId });
      case 'kyb':
        if (snapshot.kybStatus === 'rejected' && snapshot.kybReason !== null) {
          return t('kybRejectedReason', { reason: snapshot.kybReason });
        }
        if (snapshot.kybStatus === 'pending') {
          return t('kybPendingDetail');
        }
        if (snapshot.kybStatus === 'verified') {
          return snapshot.kybReason ?? t('kybVerifiedDetail');
        }
        return t('kybNotSubmitted');
      case 'pricing':
        return snapshot.pricingConfigured ? t('pricingConfigured') : t('pricingMissing');
      case 'api_key':
        return snapshot.apiKeyIssued ? t('apiKeyIssued') : t('apiKeyMissing');
      default:
        return '';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('lede', { name: session.me.organization.name })}
        </p>
      </div>

      <Alert>
        <AlertTitle>
          {snapshot.realTransactionEligible ? t('eligibleTitle') : t('notEligibleTitle')}
        </AlertTitle>
        <AlertDescription>
          {snapshot.realTransactionEligible ? t('eligibleBody') : t('notEligibleBody')}
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t('checklist', { completed, total })}</p>
        <Progress value={(completed / total) * 100} />
      </div>

      <ul className="grid gap-3">
        {snapshot.steps.map((step) => (
          <li key={step.id}>
            <Card size="sm">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>{step.label}</CardTitle>
                  <CardDescription>{stepDetail(step)}</CardDescription>
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
                    {t('openSettings')}
                  </Link>
                </CardContent>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>

      <dl className="text-muted-foreground grid gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt>{t('mode')}</dt>
          <dd className="text-foreground font-mono">{snapshot.mode}</dd>
        </div>
        <div>
          <dt>{t('kybVendor')}</dt>
          <dd className="text-foreground font-mono">
            {snapshot.kybVendor} · {t(kybStatusKey(snapshot.kybStatus))}
          </dd>
        </div>
        <div>
          <dt>{t('pricingModel')}</dt>
          <dd className="text-foreground font-mono">{snapshot.pricingModel}</dd>
        </div>
        <div>
          <dt>{t('licensedConfigured')}</dt>
          <dd className="text-foreground">
            {snapshot.licensedProviderConfigured ? tCommon('yes') : tCommon('no')}
          </dd>
        </div>
      </dl>

      {!snapshot.licensedProviderConfigured ? (
        <DashboardEmpty title={t('licensedBlockedTitle')}>{t('licensedBlockedBody')}</DashboardEmpty>
      ) : null}
    </div>
  );
}
