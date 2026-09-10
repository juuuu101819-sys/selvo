import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
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
import { fetchDashboardInvoices } from '@/lib/api/client';
import { exponentFor } from '@/lib/currency';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { formatQuotedAmount, formatTimestamp } from '@/lib/format';

export default async function DashboardInvoicesPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const result = await fetchDashboardInvoices(session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  const invoices = result.data.invoices;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('invoicesTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('invoicesLede')}</p>
      </div>
      {invoices.length === 0 ? (
        <DashboardEmpty title={t('noInvoices')}>{t('noInvoicesBody')}</DashboardEmpty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colIssued')}</TableHead>
              <TableHead>{t('colNumber')}</TableHead>
              <TableHead>{t('colPeriod')}</TableHead>
              <TableHead>{t('colTotal')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
              <TableHead>{t('colCollection')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="font-mono text-xs">
                  {formatTimestamp(invoice.issuedAt, locale)}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/dashboard/invoices/${invoice.id}`}
                    className="text-foreground font-mono text-xs underline underline-offset-4"
                  >
                    {invoice.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {invoice.periodStart.slice(0, 7)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(
                    invoice.totalMinorUnits,
                    invoice.currency,
                    exponentFor(invoice.currency),
                    locale,
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{invoice.status}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{invoice.collectionStatus}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
