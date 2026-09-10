import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { notFound } from 'next/navigation';
import { SessionEnded } from '@/components/dashboard/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ErrorState } from '@/components/states';
import { fetchDashboardInvoice } from '@/lib/api/client';
import { exponentFor } from '@/lib/currency';
import { loadDashboardSession } from '@/lib/dashboard-auth';
import { formatQuotedAmount, formatTimestamp } from '@/lib/format';

export default async function DashboardInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const { id } = await params;
  const result = await fetchDashboardInvoice(session.token, id);
  if (!result.ok) {
    if (result.failure.code === 'NOT_FOUND') {
      notFound();
    }
    return <ErrorState failure={result.failure} />;
  }

  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  const invoice = result.data;
  const exponent = exponentFor(invoice.currency);
  const money = (minor: string): string =>
    formatQuotedAmount(minor, invoice.currency, exponent, locale);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-xs">
          <Link href="/dashboard/invoices" className="underline underline-offset-4">
            {t('invoices')}
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{invoice.invoiceNumber}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('invoiceDetailLede')}</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t('subtotal')}</CardDescription>
            <CardTitle className="font-mono text-lg tabular-nums">
              {money(invoice.subtotalMinorUnits)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t('tax')}</CardDescription>
            <CardTitle className="font-mono text-lg tabular-nums">
              {money(invoice.taxMinorUnits)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">
              {t('taxHint', { method: invoice.taxCalculation })}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t('colTotal')}</CardDescription>
            <CardTitle className="font-mono text-lg tabular-nums">
              {money(invoice.totalMinorUnits)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t('colCollection')}</CardDescription>
            <CardTitle className="text-lg">
              <Badge variant="outline">{invoice.collectionStatus}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">
              {t('issuerRealized', { entity: invoice.issuerLegalEntity })}
            </p>
          </CardContent>
        </Card>
      </section>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colSnapshot')}</TableHead>
            <TableHead>{t('colWhen')}</TableHead>
            <TableHead>{t('colStage')}</TableHead>
            <TableHead>{t('colSourceEvent')}</TableHead>
            <TableHead className="text-right">{t('colPlatformFee')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoice.lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="font-mono text-xs">{line.monetizationEventId}</TableCell>
              <TableCell className="font-mono text-xs">
                {formatTimestamp(line.occurredAt, locale)}
              </TableCell>
              <TableCell className="text-xs">{line.economicStage.replaceAll('_', ' ')}</TableCell>
              <TableCell className="text-xs">{line.revenueSource.replaceAll('_', ' ')}</TableCell>
              <TableCell className="font-mono text-xs tabular-nums">
                {money(line.platformRevenueMinorUnits)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
