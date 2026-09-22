import { SectionShell } from './section-shell';

const FAQ_ITEMS = [
  {
    id: 'non-custodial',
    q: 'Does Meridian hold my funds or keys?',
    a: 'No. Meridian is non-custodial by architecture — it compares routes and returns signed decisions. Licensed partners settle; Meridian never holds funds, keys or wallets.',
  },
  {
    id: 'sandbox',
    q: 'What does sandbox mode mean?',
    a: 'Sandbox is the default. Quotes are indicative and non-binding until you act with a licensed partner. No funds move through Meridian.',
  },
  {
    id: 'best-execution',
    q: 'How is best execution determined?',
    a: 'Routes are scored on all-in cost vs mid-market, speed, liquidity, reliability and compliance. The recommended route is returned with reasoning — not an instruction to move money.',
  },
  {
    id: 'spread-fee',
    q: 'How do spread and fee show up in a quote?',
    a: 'Every route is priced vs mid-market so spread and stated fees are visible together. Zero-fee quotes with wide spreads are surfaced explicitly — illustrative demos on this page are labelled as such.',
  },
  {
    id: 'corridors',
    q: 'Which corridors are supported?',
    a: 'Sandbox covers a growing set of corridors (USD/EUR, USD/KRW and others). Map arcs show comparison coverage — not live settlement paths.',
  },
  {
    id: 'pricing',
    q: 'How is Meridian priced?',
    a: 'Illustrative tiers charge per comparison or monthly for dashboard access — never spread markup. Sandbox is free; final rates are confirmed at launch.',
  },
] as const;

/**
 * FAQ accordion using native details/summary — mockup batch 3/3.
 */
export function LandingFaq() {
  return (
    <SectionShell eyebrow="FAQ" heading="Common questions">
      <div className="space-y-2">
        {FAQ_ITEMS.map((item) => (
          <details
            key={item.id}
            className="marketing-surface group rounded-xl px-4 py-3 sm:px-5 sm:py-4"
          >
            <summary className="cursor-pointer list-none text-sm font-semibold marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-3">
                {item.q}
                <span
                  aria-hidden
                  className="text-muted-foreground text-lg leading-none transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </span>
            </summary>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{item.a}</p>
          </details>
        ))}
      </div>
    </SectionShell>
  );
}
