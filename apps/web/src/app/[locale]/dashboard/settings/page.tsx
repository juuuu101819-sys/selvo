import { getTranslations } from 'next-intl/server';
import { DashboardEmpty, SessionEnded } from '@/components/dashboard/states';
import { ApiKeyManager } from '@/components/dashboard/api-key-manager';
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
import { fetchDashboardSettings, fetchMfaStatus } from '@/lib/api/client';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { SecuritySettings } from './security-settings';
import { ExecutionConsentForm } from '@/components/dashboard/execution-consent-form';

export default async function DashboardSettingsPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const result = await fetchDashboardSettings(session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const t = await getTranslations('dashboard');
  const tCommon = await getTranslations('common');
  const { organization, members, apiKeys, role, auth } = result.data;
  const mfa = await fetchMfaStatus(session.token);
  const canManageOrg = role === 'owner' || role === 'admin' || session.me.role === 'owner' || session.me.role === 'admin';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('settingsTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('settingsLede', { name: organization?.name ?? session.me.organization.name })}
        </p>
      </div>

      <section className="border-border rounded-xl border p-4 sm:p-5">
        <h2 className="text-sm font-semibold">{t('tenant')}</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('name')}</dt>
            <dd>{organization?.name ?? tCommon('emDash')}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('slug')}</dt>
            <dd className="font-mono text-xs">{organization?.slug ?? tCommon('emDash')}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('country')}</dt>
            <dd className="font-mono text-xs">{organization?.countryCode ?? tCommon('emDash')}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('yourRole')}</dt>
            <dd>
              <Badge variant="secondary">{role ?? session.me.role ?? 'member'}</Badge>
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold">{t('members')}</h2>
        {members.length === 0 ? (
          <DashboardEmpty title={t('noMembers')}>{t('noMembersBody')}</DashboardEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colName')}</TableHead>
                <TableHead>{t('colEmail')}</TableHead>
                <TableHead>{t('colRole')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>{member.displayName}</TableCell>
                  <TableCell className="font-mono text-xs">{member.email}</TableCell>
                  <TableCell>{member.role}</TableCell>
                  <TableCell>{member.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <ApiKeyManager
        keys={apiKeys}
        canManage={role === 'owner' || role === 'admin' || session.me.role === 'owner'}
      />

      {mfa.ok ? (
        <SecuritySettings
          mfa={mfa.data}
          requireMfaForPrivilegedRoles={auth?.requireMfaForPrivilegedRoles ?? false}
          oidc={
            auth?.oidc ?? {
              configured: false,
              enabled: false,
              issuer: null,
              clientId: null,
              redirectUri: null,
              hasClientSecret: false,
            }
          }
          canManageOrg={canManageOrg}
        />
      ) : null}

      <ExecutionConsentForm
        kind="organization"
        authorized={organization?.executionAuthorized ?? false}
        agreementReference={organization?.executionAgreementReference ?? null}
        canManage={canManageOrg}
      />
    </div>
  );
}
