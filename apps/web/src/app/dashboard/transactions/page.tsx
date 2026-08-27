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
import { fetchDashboardTransactions } from '@/lib/api/client';
import { exponentFor } from '@/lib/currency';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { formatQuotedAmount, formatTimestamp } from '@/lib/format';

export default async function DashboardTransactionsPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const result = await fetchDashboardTransactions(session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const transactions = result.data.transactions;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Priced requests, not settlements. Meridian never records a payment moving.
        </p>
      </div>
      {transactions.length === 0 ? (
        <DashboardEmpty title="No transaction requests">
          Requests appear here after this organization asks the engine to price a corridor.
        </DashboardEmpty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Corridor</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Quotes</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">
                  {formatTimestamp(row.createdAt)}
                </TableCell>
                <TableCell className="font-mono text-xs">{row.reference ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs">
                  {row.sourceCurrency}→{row.targetCurrency}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(
                    row.amountMinorUnits,
                    row.sourceCurrency,
                    exponentFor(row.sourceCurrency),
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{row.quoteCount}</TableCell>
                <TableCell>
                  <Badge variant="outline">{row.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
