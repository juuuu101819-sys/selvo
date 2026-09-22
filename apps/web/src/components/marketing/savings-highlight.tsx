import { Badge } from '@/components/ui/badge';
import { SectionShell } from './section-shell';

/** Illustrative all-in cost rows for the sandbox demo — not live quotes. */
const COST_ROWS = [
  { id: 'card', label: 'Card / PSP', bps: 342, percent: '3.42%' },
  { id: 'bank', label: 'Bank wire', bps: 214, percent: '2.14%' },
  { id: 'fx', label: 'FX provider', bps: 128, percent: '1.28%' },
  { id: 'meridian', label: 'Meridian (best route)', bps: 44, percent: '0.44%', best: true },
] as const;

const MAX_BPS = COST_ROWS[0].bps;

function barWidth(bps: number): number {
  return Math.max(4, Math.round((bps / MAX_BPS) * 100));
}

/**
 * Savings hero from the approved mockup. Demo figures only — labelled illustrative.
 */
export function SavingsHighlight() {
  return (
    <SectionShell
      eyebrow="Savings"
      heading="You keep more of every transfer"
      subheading="Illustrative sandbox sample on a USD 50,000 → EUR intent. Not a live quote or guarantee."
    >
      <div className="marketing-surface space-y-8 rounded-2xl p-5 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="font-display text-accent text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">
              $847
            </p>
            <p className="text-muted-foreground text-sm">saved on all-in cost in this sample</p>
          </div>
          <Badge variant="accent" className="w-fit text-[11px] uppercase tracking-wide">
            vs a typical bank wire
          </Badge>
        </div>

        <div className="space-y-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
            All-in cost comparison
          </p>
          <ul className="space-y-3" aria-label="Illustrative all-in cost comparison">
            {COST_ROWS.map((row) => (
              <li key={row.id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">
                    {row.label}
                    {'best' in row && row.best ? (
                      <span className="text-accent ml-2 text-xs font-semibold uppercase tracking-wide">
                        Best
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums">{row.percent}</span>
                </div>
                <div className="bg-muted/80 relative mt-1.5 h-2 overflow-hidden rounded-full">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full ${
                      'best' in row && row.best ? 'bg-accent' : 'bg-primary/60'
                    }`}
                    style={{ width: `${barWidth(row.bps)}%` }}
                    role="presentation"
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-muted-foreground border-border/50 border-t pt-4 text-xs leading-relaxed">
          Illustrative sample only. Every live comparison is priced vs mid-market and returned as a
          signed, non-binding recommendation — Meridian never holds funds or keys.
        </p>
      </div>
    </SectionShell>
  );
}
