import { getLocale, getTranslations } from 'next-intl/server';
import { DashboardEmpty, SessionEnded } from '@/components/dashboard/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ErrorState } from '@/components/states';
import { ProviderLicensingBadge } from '@/components/provider-licensing-badge';
import { fetchDashboardProviders } from '@/lib/api/client';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { formatBps } from '@/lib/format';
import { formatSettlementMessage } from '@/lib/format-i18n';

export default async function DashboardProvidersPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const result = await fetchDashboardProviders(session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const t = await getTranslations('dashboard');
  const tCommon = await getTranslations('common');
  const tTime = await getTranslations('time');
  const locale = await getLocale();
  const providers = result.data.providers;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('providersTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('providersLede')}</p>
      </div>
      {providers.length === 0 ? (
        <DashboardEmpty title={t('noProviderUsage')}>{t('noProviderUsageBody')}</DashboardEmpty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colProvider')}</TableHead>
              <TableHead>{t('colSource')}</TableHead>
              <TableHead>{t('colRail')}</TableHead>
              <TableHead>{t('colQuotes')}</TableHead>
              <TableHead>{t('colRecommended')}</TableHead>
              <TableHead>{t('colAvgCost')}</TableHead>
              <TableHead>{t('colAvgSettlement')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {providers.map((provider) => (
              <TableRow key={provider.providerId}>
                <TableCell>{provider.providerName}</TableCell>
                <TableCell>
                  <ProviderLicensingBadge licensing={provider.licensing} />
                </TableCell>
                <TableCell className="font-mono text-xs">{provider.rail}</TableCell>
                <TableCell className="tabular-nums">{provider.quoteCount}</TableCell>
                <TableCell className="tabular-nums">{provider.recommendedCount}</TableCell>
                <TableCell className="font-mono text-xs">
                  {provider.averageCostBps === null
                    ? tCommon('emDash')
                    : formatBps(provider.averageCostBps, 1, locale)}
                </TableCell>
                <TableCell className="text-xs">
                  {provider.averageSettlementP50Seconds === null
                    ? tCommon('emDash')
                    : formatSettlementMessage(tTime, provider.averageSettlementP50Seconds, false)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
