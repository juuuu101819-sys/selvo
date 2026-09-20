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

/** Mirrors the API's `lifecycleState`; an unknown value is shown verbatim rather than guessed. */
const LIFECYCLE_LABELS: Record<string, string> = {
  QUOTED_REVENUE: 'Quoted',
  EXPECTED_REVENUE: 'Expected',
  ATTRIBUTED_REVENUE: 'Attributed',
  REALIZED_REVENUE: 'Realized',
};

export function RevenueReport({ report }: { report: MonetizationReportDto }) {
  const { summary, workedExample, gainShareActive } = report;
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
    // Gain share is the highest-risk pricing shape. While its flag is off it is not charged at
    // all, so the card is absent rather than showing a zero a reader could mistake for an
    // arithmetic result.
    ...(gainShareActive
      ? [
          {
            title: 'Partner commission',
            value: money(summary.partnerCommissionMinorUnits),
            hint: 'Share of platform revenue paid to a referring partner. Default 25%.',
          },
        ]
      : []),
    {
      title: 'Gross profit',
      value: money(summary.grossProfitMinorUnits),
      hint: gainShareActive
        ? 'Platform revenue minus partner commission. Net platform contribution.'
        : 'Equal to platform revenue: gain share is off, so no partner payout is deducted.',
    },
    {
      title: 'Take rate',
      value: formatTakeRate(summary.takeRateBps),
      hint: 'Platform revenue as basis points of TPV. Null when TPV is zero.',
    },
    {
      title: 'Invoiced',
      value: money(summary.invoicedRevenueMinorUnits),
      hint: 'Platform fees copied onto issued invoices. Not cash received until one is collected.',
    },
    {
      title: 'Collected',
      value: money(summary.collectedRevenueMinorUnits),
      hint: 'Confirmed payment against an invoice, evidenced by a processor reference.',
    },
    {
      title: 'Events',
      value: String(summary.eventCount),
      hint: 'Quoted and simulated activity only. Funds never moved.',
    },
  ];

  // The lifecycle cards are kept apart from the totals above because only the last of them is
  // cash. Presenting them in one undifferentiated grid is how a quoted figure gets read as
  // revenue.
  const lifecycleCards = [
    {
      title: 'Quoted',
      value: money(summary.quotedRevenueMinorUnits),
      hint: 'Attributed to a priced quote. No commitment from anyone, and not cash.',
    },
    {
      title: 'Expected',
      value: money(summary.expectedRevenueMinorUnits),
      hint: 'A route was selected or an execution intent was recorded. Still not cash.',
    },
    {
      title: 'Attributed',
      value: money(summary.attributedRevenueMinorUnits),
      hint: 'Backed by a settlement or an issued invoice. Billed at most, not collected.',
    },
    {
      title: 'Realized',
      value: money(summary.realizedRevenueMinorUnits),
      hint: 'Collected against a provider-confirmed settlement in production. The only figure here that is cash.',
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
          <CardTitle>Revenue lifecycle</CardTitle>
          <CardDescription>
            Every figure above sits in one of these four states. Revenue is only cash in the last
            one, which requires a production origin, a provider-confirmed settlement, and a
            collection reference. A simulated or sandbox settlement can never reach it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <section
            aria-label="Revenue lifecycle states"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            {lifecycleCards.map((card) => (
              <div key={card.title} className="space-y-1">
                <p className="text-muted-foreground text-xs">{card.title}</p>
                <p className="font-mono text-lg tabular-nums">{card.value}</p>
                <p className="text-muted-foreground text-xs">{card.hint}</p>
              </div>
            ))}
          </section>
          {BigInt(summary.simulatedOriginRevenueMinorUnits) > 0n ? (
            <p className="text-muted-foreground border-t pt-3 text-xs">
              {money(summary.simulatedOriginRevenueMinorUnits)} of the above came from a demo,
              simulation, or partner-sandbox origin and can never be realized.{' '}
              {money(summary.settledStageRevenueMinorUnits)} is attributed to a settlement,
              simulated settlements included.
            </p>
          ) : null}
        </CardContent>
      </Card>

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
            {gainShareActive ? (
              <ExampleStat
                label="Partner commission"
                value={formatQuotedAmount(
                  workedExample.partnerCommissionMinorUnits,
                  workedExample.currency,
                  2,
                )}
              />
            ) : null}
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
        description={
          gainShareActive
            ? 'Closed set of nine sources. Partner commission is also shown as a payout row.'
            : 'Closed set of nine sources. Gain share is disabled, so there is no partner payout row.'
        }
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
        <BreakdownTable
          title="By lifecycle state"
          description="Quoted, expected, attributed, realized. Only realized is cash."
          rows={report.byLifecycleState}
          currency={summary.currency}
          exponent={summary.exponent}
        />
        <BreakdownTable
          title="By origin environment"
          description="Demo, simulation and partner-sandbox rows are incapable of realizing."
          rows={report.byOriginEnv}
          currency={summary.currency}
          exponent={summary.exponent}
        />
      </div>

      <EventsTable
        events={report.events}
        currency={summary.currency}
        exponent={summary.exponent}
        gainShareActive={gainShareActive}
      />
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
              <TableHead className="text-right">Realized</TableHead>
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
                      className="bg-chart-1/80 h-1.5 rounded-full"
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
                  {formatQuotedAmount(row.realizedRevenueMinorUnits, currency, exponent)}
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
  gainShareActive,
}: {
  events: readonly MonetizationEventDto[];
  currency: string;
  exponent: number;
  gainShareActive: boolean;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold">Ledger</h2>
        <p className="text-muted-foreground text-xs">
          Each row is a quoted or simulated event. <code>fundsMoved</code> is always false. The
          state column says what the amounts mean; only <code>Realized</code> is cash.
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Corridor</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">TPV</TableHead>
              <TableHead className="text-right">Platform</TableHead>
              {gainShareActive ? <TableHead className="text-right">Partner</TableHead> : null}
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
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-xs">
                      {LIFECYCLE_LABELS[event.lifecycleState] ?? event.lifecycleState}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {event.originEnv}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(event.tpvMinorUnits, currency, exponent)}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {formatQuotedAmount(event.platformRevenueMinorUnits, currency, exponent)}
                </TableCell>
                {gainShareActive ? (
                  <TableCell className="font-mono text-xs tabular-nums">
                    {formatQuotedAmount(event.partnerCommissionMinorUnits, currency, exponent)}
                  </TableCell>
                ) : null}
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
