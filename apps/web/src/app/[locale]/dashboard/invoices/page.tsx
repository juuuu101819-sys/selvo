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

  const invoices = result.data.invoices;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Monthly platform-fee invoices copied from recorded monetization snapshots. Issued is not
          collected: payment collection is deferred until a legal entity, tax handling, and
          payment mechanism are confirmed. Realized revenue stays false.
        </p>
      </div>
      {invoices.length === 0 ? (
        <DashboardEmpty title="No invoices issued yet">
          Invoices are generated at month-end from execution-intent and subscription snapshots.
          Route quotes are never billed. Nothing here means cash was received.
        </DashboardEmpty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Issued</TableHead>
              <TableHead>Number</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Collection</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="font-mono text-xs">
                  {formatTimestamp(invoice.issuedAt)}
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
