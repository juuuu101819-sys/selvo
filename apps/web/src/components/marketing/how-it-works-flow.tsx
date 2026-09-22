import { ArrowRight } from 'lucide-react';

const INSIDE_STEPS = [
  { id: 'intent', label: 'Intent', detail: 'Normalized financial request' },
  { id: 'compare', label: 'Compare rails', detail: 'Bank, FX, stablecoin, liquidity' },
  { id: 'compliance', label: 'Compliance check', detail: 'Eligibility & jurisdiction' },
  { id: 'decision', label: 'Best-execution decision', detail: 'Signed route recommendation' },
] as const;

const OUTSIDE_STEP = {
  label: 'Licensed partner settles',
  detail: 'Funds move outside Meridian — POST /executions stays 501',
} as const;

/**
 * Non-custodial boundary flow from the approved mockup. Steps 1–4 run inside Meridian;
 * settlement is explicitly outside the platform boundary.
 */
export function HowItWorksFlow() {
  return (
    <section aria-labelledby="how-it-works-flow-heading" className="space-y-8">
      <div className="max-w-2xl space-y-2">
        <p className="text-accent text-xs font-semibold tracking-widest uppercase">How it works</p>
        <h2 id="how-it-works-flow-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          From intent to decision — settlement stays with your partner
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
          Meridian compares, scores and signs. It never holds funds, keys or wallets, and does not
          execute transactions.
        </p>
      </div>

      <div className="space-y-5">
        <div className="border-primary/35 marketing-surface rounded-2xl border border-dashed p-4 sm:p-6">
          <p className="text-primary mb-4 font-mono text-[11px] font-medium tracking-widest uppercase">
            Inside Meridian
          </p>
          <ol className="grid gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))] lg:gap-2">
            {INSIDE_STEPS.map((step, index) => (
              <li key={step.id} className="relative flex min-w-0 flex-col gap-2">
                <div className="flex items-center gap-2 lg:block">
                  <span className="bg-primary/15 text-primary flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs tabular-nums">
                    {index + 1}
                  </span>
                  {index < INSIDE_STEPS.length - 1 ? (
                    <ArrowRight
                      aria-hidden
                      className="text-muted-foreground/60 size-4 shrink-0 lg:hidden"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 space-y-1">
                  <h3 className="text-sm font-semibold leading-snug">{step.label}</h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">{step.detail}</p>
                </div>
                {index < INSIDE_STEPS.length - 1 ? (
                  <ArrowRight
                    aria-hidden
                    className="text-muted-foreground/40 absolute top-3 -right-3 hidden size-4 lg:block xl:-right-4"
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col items-center gap-3" aria-hidden>
          <div className="via-primary/40 h-8 w-px bg-gradient-to-b from-transparent to-transparent bg-[linear-gradient(180deg,transparent,var(--primary),transparent)] opacity-60" />
          <span className="border-border/60 text-muted-foreground rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-widest">
            Non-custodial boundary
          </span>
          <div className="via-primary/40 h-8 w-px bg-gradient-to-b from-transparent to-transparent bg-[linear-gradient(180deg,transparent,var(--primary),transparent)] opacity-60" />
        </div>

        <article className="marketing-surface-feature marketing-surface rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-3 sm:gap-4">
            <span className="bg-accent/15 text-accent-foreground flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs tabular-nums">
              5
            </span>
            <div className="min-w-0 space-y-1">
              <h3 className="text-base font-semibold">{OUTSIDE_STEP.label}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{OUTSIDE_STEP.detail}</p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
