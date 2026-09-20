import { getLocale, getTranslations } from 'next-intl/server';
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
import { formatBps, formatQuotedAmount, formatTimestamp } from '@/lib/format';
import { formatSettlementMessage } from '@/lib/format-i18n';

export default async function DashboardQuotesPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const result = await fetchDashboardQuotes(session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const t = await getTranslations('dashboard');
  const tCommon = await getTranslations('common');
  const tTime = await getTranslations('time');
  const locale = await getLocale();
  const quotes = result.data.quotes;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('quotesTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('quotesLede')}</p>
      </div>
      {quotes.length === 0 ? (
        <DashboardEmpty title={t('noQuotesOrg')}>{t('noQuotesOrgBody')}</DashboardEmpty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colQuoted')}</TableHead>
              <TableHead>{t('colCorridor')}</TableHead>
              <TableHead>{t('colAmount')}</TableHead>
              <TableHead>{t('colProvider')}</TableHead>
              <TableHead>{t('colCost')}</TableHead>
              <TableHead>{t('colSettlement')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((quote) => (
              <TableRow key={quote.id}>
                <TableCell className="font-mono text-xs">
                  {formatTimestamp(quote.quotedAt, locale)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {quote.sourceCurrency}→{quote.targetCurrency}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(
                    quote.amountMinorUnits,
                    quote.sourceCurrency,
                    exponentFor(quote.sourceCurrency),
                    locale,
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{quote.providerName}</span>
                    <span className="text-muted-foreground font-mono text-xs">{quote.rail}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatBps(quote.totalCostBps, 1, locale)}
                </TableCell>
                <TableCell className="text-xs">
                  {formatSettlementMessage(tTime, quote.settlementP50Seconds, false)}
                </TableCell>
                <TableCell>
                  {quote.isRecommended ? (
                    <Badge variant="recommend">{tCommon('recommended')}</Badge>
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
