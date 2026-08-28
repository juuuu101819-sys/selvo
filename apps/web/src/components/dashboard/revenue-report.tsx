import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  MonetizationBreakdownRowDto,
  MonetizationEventDto,
  MonetizationReportDto,
} from '@/lib/api/types';
import { formatQuotedAmount, formatTakeRate, formatTimestamp, sharePercent } from '@/lib/format';

export function RevenueReport({ report }: { report: MonetizationReportDto }) {
  const { summary, workedExample } = report;
  const money = (minorUnits: string): string =>
    formatQuotedAmount(minorUnits, summary.currency, summary.exponent);

  const cards = [
    {
      title: 'TPV',
      value: money(summary.tpvMinorUnits),
      hint: 'Quoted send notional in the reporting currency. Subscriptions contribute zero.',
    },
    {
      title: 'Gross revenue',
      value: money(summary.grossRevenueMinorUnits),
      hint: 'Platform routing fees. Equal to platform revenue — provider cost is not included.',
    },
    {
      title: 'Provider cost',
      value: money(summary.providerCostMinorUnits),
      hint: 'Provider source and destination fees, valued in the send asset. Not FX spread.',
    },
    {
      title: 'Platform revenue',
      value: money(summary.platformRevenueMinorUnits),
      hint: 'What Meridian quotes as its routing fee before partner payout.',
    },
    {
      title: 'Partner commission',
      value: money(summary.partnerCommissionMinorUnits),
      hint: 'Share of platform revenue paid to a referring partner. Default 25%.',
    },
    {
      title: 'Gross profit',
      value: money(summary.grossProfitMinorUnits),
      hint: 'Platform revenue minus partner commission. Net platform contribution.',
    },
    {
      title: 'Take rate',
      value: formatTakeRate(summary.takeRateBps),
      hint: 'Platform revenue as basis points of TPV. Null when TPV is zero.',
    },
    {
      title: 'Realized revenue',
      value: money(summary.realizedRevenueMinorUnits),
      hint: 'Only a verified external settlement can realize revenue. Route quotes, selections, and execution intents stay at zero.',
    },
    {
      title: 'Invoiced',
      value: money(summary.invoicedRevenueMinorUnits),
      hint: 'Platform fees copied onto issued invoices. Not cash received. Collection is deferred.',
    },
    {
      title: 'Collected',
      value: money(summary.collectedRevenueMinorUnits),
      hint: 'Confirmed payment against an invoice. Always zero until a payment collector is wired.',
    },
    {
      title: 'Events',
      value: String(summary.eventCount),
      hint: 'Quoted and simulated activity only. Funds never moved. None of these events are realized revenue.',
    },
  ];

  return (
    <div className="space-y-6">
      <section aria-label="Revenue totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.title} size="sm">
            <CardHeader>
              <CardDescription>{card.title}</CardDescription>
              <CardTitle className="font-mono text-lg tabular-nums">{card.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">{card.hint}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Worked example</CardTitle>
          <CardDescription>
            Canonical identity the engine is tested against. Amounts in {workedExample.currency}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{workedExample.description}</p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <ExampleStat
              label="Transaction / TPV"
              value={formatQuotedAmount(workedExample.tpvMinorUnits, workedExample.currency, 2)}
            />
            <ExampleStat
              label="Provider cost"
              value={formatQuotedAmount(
                workedExample.providerCostMinorUnits,
                workedExample.currency,
                2,
              )}
            />
            <ExampleStat
              label="Platform routing fee"
              value={formatQuotedAmount(
                workedExample.platformRevenueMinorUnits,
                workedExample.currency,
                2,
              )}
            />
            <ExampleStat
              label="Partner commission"
              value={formatQuotedAmount(
                workedExample.partnerCommissionMinorUnits,
                workedExample.currency,
                2,
              )}
            />
            <ExampleStat
              label="Net platform contribution"
              value={formatQuotedAmount(
                workedExample.grossProfitMinorUnits,
                workedExample.currency,
                2,
              )}
            />
            <ExampleStat label="Take rate" value={`${workedExample.takeRateBps} bps`} />
          </dl>
        </CardContent>
      </Card>

      <BreakdownTable
        title="By revenue source"
        description="Closed set of nine sources. Partner commission is also shown as a payout row."
        rows={report.byRevenueSource}
        currency={summary.currency}
        exponent={summary.exponent}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <BreakdownTable
          title="By rail"
          description="Traditional FX, payments, stablecoin, DeFi and liquidity."
          rows={report.byRail}
          currency={summary.currency}
          exponent={summary.exponent}
        />
        <BreakdownTable
          title="By provider"
          description="Licensed partner that priced the recommended route."
          rows={report.byProvider}
          currency={summary.currency}
          exponent={summary.exponent}
        />
        <BreakdownTable
          title="By currency"
          description="Reporting split when events are denominated differently."
          rows={report.byCurrency}
          currency={summary.currency}
          exponent={summary.exponent}
        />
        <BreakdownTable
          title="By asset"
          description="Send asset on the quoted route."
          rows={report.byAsset}
          currency={summary.currency}
          exponent={summary.exponent}
        />
        <BreakdownTable
          title="By organization"
          description="Always this tenant. Another organization's rows never enter the query."
          rows={report.byOrganization}
          currency={summary.currency}
          exponent={summary.exponent}
        />
        <BreakdownTable
          title="By AI agent"
          description="Agent payment fees attributed to a specific agent credential."
          rows={report.byAgent}
          currency={summary.currency}
          exponent={summary.exponent}
          empty="No AI-agent payment fees in this window."
        />
        <BreakdownTable
          title="By transaction type"
          description="Fiat comparison, multi-rail quote, agent payment, or subscription."
          rows={report.byTransactionType}
          currency={summary.currency}
          exponent={summary.exponent}
        />
        <BreakdownTable
          title="By date"
          description="Calendar day of the quote or simulation, UTC."
          rows={report.byDate}
          currency={summary.currency}
          exponent={summary.exponent}
        />
      </div>

      <EventsTable events={report.events} currency={summary.currency} exponent={summary.exponent} />
    </div>
  );
}

function ExampleStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

function BreakdownTable({
  title,
  description,
  rows,
  currency,
  exponent,
  empty,
}: {
  title: string;
  description: string;
  rows: readonly MonetizationBreakdownRowDto[];
  currency: string;
  exponent: number;
  empty?: string;
}) {
  const maxRevenue = rows.reduce((max, row) => {
    const value = BigInt(row.platformRevenueMinorUnits);
    return value > max ? value : max;
  }, 0n);

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty ?? 'No rows in this breakdown.'}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slice</TableHead>
              <TableHead className="text-right">TPV</TableHead>
              <TableHead className="text-right">Platform</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">Take rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span>{row.label}</span>
                    <span
                      className="bg-emerald-600/80 h-1.5 rounded-full"
                      style={{
                        width: `${sharePercent(row.platformRevenueMinorUnits, maxRevenue.toString())}%`,
                      }}
                    />
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(row.tpvMinorUnits, currency, exponent)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(row.platformRevenueMinorUnits, currency, exponent)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(row.grossProfitMinorUnits, currency, exponent)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatTakeRate(row.takeRateBps)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function EventsTable({
  events,
  currency,
  exponent,
}: {
  events: readonly MonetizationEventDto[];
  currency: string;
  exponent: number;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold">Ledger</h2>
        <p className="text-muted-foreground text-xs">
          Each row is a quoted or simulated event. <code>fundsMoved</code> is always false.
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Corridor</TableHead>
              <TableHead className="text-right">TPV</TableHead>
              <TableHead className="text-right">Platform</TableHead>
              <TableHead className="text-right">Partner</TableHead>
              <TableHead className="text-right">Profit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-mono text-xs">
                  {formatTimestamp(event.occurredAt)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{event.revenueSource.replaceAll('_', ' ')}</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {event.providerName ?? event.transactionType}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {event.asset}
                  {event.destinationAsset === null ? '' : `→${event.destinationAsset}`}
                  {event.agentId === null ? '' : ` · ${event.agentId}`}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(event.tpvMinorUnits, currency, exponent)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(event.platformRevenueMinorUnits, currency, exponent)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(event.partnerCommissionMinorUnits, currency, exponent)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(event.grossProfitMinorUnits, currency, exponent)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
