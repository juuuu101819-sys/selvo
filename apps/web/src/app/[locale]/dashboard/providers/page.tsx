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
import { formatBps, formatSettlement } from '@/lib/format';

export default async function DashboardProvidersPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const result = await fetchDashboardProviders(session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const providers = result.data.providers;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Providers</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Usage is derived from this organization&apos;s stored quotes, not from a global catalogue.
        </p>
      </div>
      {providers.length === 0 ? (
        <DashboardEmpty title="No provider usage yet">
          Providers appear once this organization has at least one stored quote.
        </DashboardEmpty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Rail</TableHead>
              <TableHead>Quotes</TableHead>
              <TableHead>Recommended</TableHead>
              <TableHead>Avg cost</TableHead>
              <TableHead>Avg settlement</TableHead>
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
                  {provider.averageCostBps === null ? '—' : formatBps(provider.averageCostBps)}
                </TableCell>
                <TableCell className="text-xs">
                  {provider.averageSettlementP50Seconds === null
                    ? '—'
                    : formatSettlement(provider.averageSettlementP50Seconds, false)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
