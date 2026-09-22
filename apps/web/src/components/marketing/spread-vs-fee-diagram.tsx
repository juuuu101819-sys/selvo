import { Badge } from '@/components/ui/badge';
import { SectionShell } from './section-shell';

/** Illustrative $10,000 USD → EUR sample — segment widths are demo-only. */
const QUOTES = [
  {
    id: 'wide-spread',
    label: 'Zero fee · wide spread',
    receive: 9720,
    spread: 220,
    fee: 60,
    total: 10_000,
  },
  {
    id: 'keen-rate',
    label: 'Small fee · keen rate',
    receive: 9890,
    spread: 80,
    fee: 30,
    total: 10_000,
  },
] as const;

function segmentWidth(value: number, total: number): number {
  return Math.max(2, Math.round((value / total) * 100));
}

function QuoteBar({ quote }: { quote: (typeof QUOTES)[number] }) {
  const receiveW = segmentWidth(quote.receive, quote.total);
  const spreadW = segmentWidth(quote.spread, quote.total);
  const feeW = segmentWidth(quote.fee, quote.total);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{quote.label}</p>
        <p className="text-muted-foreground font-mono text-xs tabular-nums">
          ${quote.receive.toLocaleString('en-US')} received
        </p>
      </div>
      <div className="bg-muted/50 flex h-3 overflow-hidden rounded-full" role="img" aria-hidden>
        <div className="bg-recommend h-full" style={{ width: `${receiveW}%` }} />
        <div className="bg-primary/75 h-full" style={{ width: `${spreadW}%` }} />
        <div className="bg-accent h-full" style={{ width: `${feeW}%` }} />
      </div>
    </div>
  );
}

/**
 * Spread vs fee decomposition — illustrative demo bars from the approved mockup.
 */
export function SpreadVsFeeDiagram() {
  return (
    <SectionShell
      eyebrow="Spread vs fee"
      heading="All-in cost is more than the headline fee"
      subheading="Illustrative sandbox sample on USD 10,000 → EUR. Not a live quote."
    >
      <div className="marketing-surface space-y-6 rounded-2xl p-5 sm:p-8">
        <div className="flex flex-wrap gap-3">
          <Badge variant="recommend" className="text-[10px] uppercase">
            Receive amount
          </Badge>
          <Badge variant="default" className="text-[10px] uppercase">
            Spread vs mid
          </Badge>
          <Badge variant="accent" className="text-[10px] uppercase">
            Stated fee
          </Badge>
        </div>

        <div className="space-y-6">
          {QUOTES.map((quote) => (
            <QuoteBar key={quote.id} quote={quote} />
          ))}
        </div>

        <p className="text-muted-foreground border-border/50 border-t pt-4 text-xs leading-relaxed">
          Illustrative only. Meridian prices every route vs mid-market so spread and fee are visible
          together — never holds funds or keys, and does not markup spreads.
        </p>
      </div>
    </SectionShell>
  );
}
