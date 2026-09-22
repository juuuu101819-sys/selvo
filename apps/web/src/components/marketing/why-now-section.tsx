const PILLARS = [
  {
    id: 'fragmentation',
    title: 'Fragmentation',
    body: 'Bank FX, PSPs, stablecoin ramps and liquidity venues each quote in their own format — nothing compares them on one axis.',
  },
  {
    id: 'hidden-cost',
    title: 'Hidden cost',
    body: 'Zero-fee quotes can hide wide spreads. Without all-in cost vs mid-market, teams cannot see what they actually keep.',
  },
  {
    id: 'neutrality',
    title: 'Neutrality requires non-custody',
    body: 'A neutral decision layer cannot hold funds or keys. Meridian compares and signs — licensed partners settle.',
  },
] as const;

/**
 * Why-now narrative on a lighter band — mockup batch 3/3.
 */
export function WhyNowSection() {
  return (
    <div className="-mx-4 sm:-mx-6">
      <div className="bg-secondary/25 border-border/40 border-y px-4 py-12 sm:px-6 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
          <div className="space-y-3">
            <p className="text-accent text-xs font-semibold tracking-widest uppercase">Why now</p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
              Money moves through more rails than ever — and nothing compares them.
            </h2>
          </div>
          <ul className="space-y-5">
            {PILLARS.map((pillar) => (
              <li
                key={pillar.id}
                className="border-accent/40 border-l-[3px] py-1 pl-4 sm:pl-5"
              >
                <h3 className="text-sm font-semibold">{pillar.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{pillar.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
