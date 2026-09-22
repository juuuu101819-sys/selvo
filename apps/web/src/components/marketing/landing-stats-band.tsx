'use client';

import { useInViewCountUp } from './use-in-view-count-up';

const STATS = [
  { id: 'rails', target: 4, suffix: '', label: 'rail classes' },
  { id: 'corridors', target: 5, suffix: '', label: 'corridors priced' },
  { id: 'mid', target: 100, suffix: '%', label: 'vs mid-market' },
  { id: 'funds', target: 0, suffix: '', label: 'funds held' },
] as const;

function StatCell({
  target,
  suffix,
  label,
}: {
  target: number;
  suffix: string;
  label: string;
}) {
  const { ref, value } = useInViewCountUp(target);

  return (
    <div ref={ref} className="marketing-surface marketing-surface-feature rounded-2xl px-4 py-5 text-center">
      <p className="font-display text-2xl font-semibold tabular-nums sm:text-3xl">
        {value}
        {suffix}
      </p>
      <p className="text-muted-foreground mt-1 text-xs sm:text-sm">{label}</p>
    </div>
  );
}

/**
 * Verifiable platform facts with scroll-triggered count-up. Values match sandbox architecture.
 */
export function LandingStatsBand() {
  return (
    <section aria-labelledby="landing-stats-heading" className="space-y-6">
      <div className="max-w-2xl space-y-2">
        <p className="text-accent text-xs font-semibold tracking-widest uppercase">Stats</p>
        <h2 id="landing-stats-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Comparable, verifiable, non-custodial
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
          Every route is priced vs mid-market. Meridian holds zero customer funds — architectural,
          not marketing.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <StatCell key={stat.id} target={stat.target} suffix={stat.suffix} label={stat.label} />
        ))}
      </div>
    </section>
  );
}
