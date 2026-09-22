import { ArrowUpRight, Building2, Globe2, Repeat2, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SectionShell } from './section-shell';

const USE_CASES: {
  id: string;
  title: string;
  body: string;
  icon: LucideIcon;
}[] = [
  {
    id: 'cross-border',
    title: 'Cross-border payouts',
    body: 'Compare bank FX, PSP and stablecoin rails on one intent before your partner settles internationally.',
    icon: Globe2,
  },
  {
    id: 'treasury',
    title: 'Treasury & FX',
    body: 'Score treasury flows on all-in cost vs mid-market, liquidity and settlement time — without moving funds.',
    icon: Wallet,
  },
  {
    id: 'marketplace',
    title: 'Marketplace settlement',
    body: 'Route marketplace payouts across corridors with compliance pre-checked per hop. Partners execute.',
    icon: Repeat2,
  },
  {
    id: 'remittance',
    title: 'Remittance',
    body: 'Surface the best-execution path for remittance corridors — indicative sandbox quotes until you act with a partner.',
    icon: Building2,
  },
];

/**
 * Use-case cards on a lighter band for visual rhythm — mockup batch 2/3.
 */
export function UseCasesSection() {
  return (
    <div className="-mx-4 sm:-mx-6">
      <div className="bg-secondary/25 border-border/40 space-y-8 rounded-none border-y px-4 py-12 sm:px-6 sm:py-14">
        <SectionShell
          eyebrow="Use cases"
          heading="Built for teams routing money across borders"
          subheading="Meridian returns decisions. Licensed partners settle — never holds funds or keys."
        >
          <ul className="grid gap-4 sm:grid-cols-2">
            {USE_CASES.map(({ id, title, body, icon: Icon }) => (
              <li
                key={id}
                className="marketing-surface-feature marketing-surface group rounded-2xl p-5 transition-colors hover:border-primary/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="bg-primary/12 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <ArrowUpRight
                    className="text-muted-foreground/40 size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </div>
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>
              </li>
            ))}
          </ul>
        </SectionShell>
      </div>
    </div>
  );
}
