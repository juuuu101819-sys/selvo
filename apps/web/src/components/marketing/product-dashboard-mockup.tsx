'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SectionShell } from './section-shell';

type PanelId = 'routes' | 'corridors' | 'compliance';

const SIDEBAR = [
  { id: 'routes' as const, label: 'Routes', interactive: true },
  { id: 'corridors' as const, label: 'Corridors', interactive: true },
  { id: 'compliance' as const, label: 'Compliance', interactive: true },
  { id: 'api-keys' as const, label: 'API keys', interactive: false },
  { id: 'settings' as const, label: 'Settings', interactive: false },
] as const;

const STAT_TILES = [
  { label: 'Routes compared', value: '12' },
  { label: 'Corridors priced', value: '5' },
  { label: 'Best-execution picks', value: '3' },
  { label: 'Executions (501)', value: '0' },
] as const;

const ROUTE_ROWS = [
  {
    corridor: 'USD → EUR',
    route: 'Stablecoin · Circle',
    cost: '0.44%',
    settlement: 'T+0',
    status: 'Recommended',
  },
  {
    corridor: 'USD → KRW',
    route: 'Bank FX · Demo Bank',
    cost: '1.12%',
    settlement: 'T+1',
    status: 'Eligible',
  },
  {
    corridor: 'GBP → USD',
    route: 'FX provider · Demo FX',
    cost: '0.89%',
    settlement: 'T+0',
    status: 'Eligible',
  },
] as const;

const CORRIDOR_ROWS = [
  { pair: 'USD / EUR', providers: '4', status: 'Priced' },
  { pair: 'USD / KRW', providers: '3', status: 'Priced' },
  { pair: 'GBP / USD', providers: '3', status: 'Priced' },
  { pair: 'EUR / GBP', providers: '2', status: 'Priced' },
  { pair: 'USD / SGD', providers: '2', status: 'Priced' },
] as const;

const COMPLIANCE_ROWS = [
  { check: 'Non-custodial posture', detail: 'Never holds funds, keys or wallets', state: 'Enforced' },
  { check: 'Execution gate', detail: 'POST /api/v1/executions returns 501', state: 'Enforced' },
  { check: 'Quote envelope', detail: 'Signed, expiring, reproducible comparison ID', state: 'Active' },
  { check: 'Settlement boundary', detail: 'Licensed partners settle — not Meridian', state: 'Required' },
] as const;

/**
 * Static product dashboard mock inside browser chrome. Sidebar switches Routes / Corridors / Compliance.
 */
export function ProductDashboardMockup() {
  const [panel, setPanel] = useState<PanelId>('routes');

  return (
    <SectionShell
      eyebrow="Product"
      heading="One dashboard for every route decision"
      subheading="Static sandbox demo — illustrative UI only. Meridian compares and signs; partners settle."
    >
      <div className="marketing-surface overflow-hidden rounded-2xl">
        <div className="border-border/60 bg-secondary/30 flex items-center gap-2 border-b px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-destructive/80" aria-hidden />
          <span className="size-2.5 rounded-full bg-accent/80" aria-hidden />
          <span className="size-2.5 rounded-full bg-recommend/80" aria-hidden />
          <p className="text-muted-foreground ml-2 flex-1 truncate rounded-md bg-background/60 px-3 py-1 font-mono text-[11px]">
            app.meridian.dev/routes
          </p>
        </div>

        <div className="grid min-h-[22rem] lg:grid-cols-[11rem_1fr]">
          <nav
            aria-label="Product demo navigation"
            className="border-border/60 bg-secondary/20 space-y-1 border-b p-3 lg:border-r lg:border-b-0"
          >
            {SIDEBAR.map((item) => {
              const active = item.interactive && item.id === panel;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!item.interactive}
                  onClick={() => {
                    if (item.interactive) {
                      setPanel(item.id);
                    }
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : item.interactive
                        ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        : 'text-muted-foreground/50 cursor-default',
                  )}
                >
                  {item.label}
                </button>
              );
            })}
            <div className="pt-2">
              <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                Sandbox
              </Badge>
            </div>
          </nav>

          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {STAT_TILES.map((tile) => (
                <div
                  key={tile.label}
                  className="marketing-surface-feature marketing-surface rounded-xl px-3 py-2.5"
                >
                  <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                    {tile.label}
                  </p>
                  <p className="font-display text-lg font-semibold tabular-nums">{tile.value}</p>
                </div>
              ))}
            </div>

            {panel === 'routes' ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-border/60 border-b">
                      <th className="pb-2 pr-3 font-medium">Corridor</th>
                      <th className="pb-2 pr-3 font-medium">Route decision</th>
                      <th className="pb-2 pr-3 font-medium">All-in</th>
                      <th className="pb-2 pr-3 font-medium">Settlement</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROUTE_ROWS.map((row) => (
                      <tr key={row.corridor} className="border-border/40 border-b last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{row.corridor}</td>
                        <td className="text-muted-foreground py-2.5 pr-3">{row.route}</td>
                        <td className="py-2.5 pr-3 font-mono tabular-nums">{row.cost}</td>
                        <td className="text-muted-foreground py-2.5 pr-3">{row.settlement}</td>
                        <td className="py-2.5">
                          {row.status === 'Recommended' ? (
                            <Badge variant="accent" className="text-[10px] uppercase">
                              {row.status}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">{row.status}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {panel === 'corridors' ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[24rem] text-left text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-border/60 border-b">
                      <th className="pb-2 pr-3 font-medium">Corridor</th>
                      <th className="pb-2 pr-3 font-medium">Providers</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CORRIDOR_ROWS.map((row) => (
                      <tr key={row.pair} className="border-border/40 border-b last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{row.pair}</td>
                        <td className="text-muted-foreground py-2.5 pr-3 font-mono tabular-nums">
                          {row.providers}
                        </td>
                        <td className="py-2.5">
                          <Badge variant="recommend" className="text-[10px] uppercase">
                            {row.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {panel === 'compliance' ? (
              <ul className="space-y-2">
                {COMPLIANCE_ROWS.map((row) => (
                  <li
                    key={row.check}
                    className="marketing-surface-feature marketing-surface flex flex-wrap items-start justify-between gap-2 rounded-xl px-3 py-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">{row.check}</p>
                      <p className="text-muted-foreground text-xs">{row.detail}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 font-mono text-[10px] uppercase">
                      {row.state}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Sample data · non-custodial · executions gated (501) · verify reproducibility via
              comparison ID on live quotes.
            </p>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
