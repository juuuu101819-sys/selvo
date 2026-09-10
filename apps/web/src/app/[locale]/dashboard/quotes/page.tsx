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
import { fetchDashboardQuotes } from '@/lib/api/client';
import { exponentFor } from '@/lib/currency';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { formatBps, formatQuotedAmount, formatSettlement, formatTimestamp } from '@/lib/format';

export default async function DashboardQuotesPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const result = await fetchDashboardQuotes(session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const quotes = result.data.quotes;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Quotes</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Provider prices stored for this organization. Cross-tenant identifiers never appear here.
        </p>
      </div>
      {quotes.length === 0 ? (
        <DashboardEmpty title="No quotes for this organization">
          A comparison run while signed in writes quotes against your tenant. The public comparison
          page does not attach an organization.
        </DashboardEmpty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quoted</TableHead>
              <TableHead>Corridor</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Settlement</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((quote) => (
              <TableRow key={quote.id}>
                <TableCell className="font-mono text-xs">
                  {formatTimestamp(quote.quotedAt)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {quote.sourceCurrency}→{quote.targetCurrency}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(
                    quote.amountMinorUnits,
                    quote.sourceCurrency,
                    exponentFor(quote.sourceCurrency),
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{quote.providerName}</span>
                    <span className="text-muted-foreground font-mono text-xs">{quote.rail}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatBps(quote.totalCostBps)}
                </TableCell>
                <TableCell className="text-xs">
                  {formatSettlement(quote.settlementP50Seconds, false)}
                </TableCell>
                <TableCell>
                  {quote.isRecommended ? (
                    <Badge>Recommended</Badge>
                  ) : (
                    <Badge variant="outline">{quote.status}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
