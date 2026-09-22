import { Badge } from '@/components/ui/badge';
import { SectionShell } from './section-shell';

type RailTag = 'live' | 'soon' | 'planned';

const RAILS: {
  id: string;
  title: string;
  body: string;
  tag: RailTag;
}[] = [
  {
    id: 'bank-fx',
    title: 'Bank FX',
    body: 'Correspondent banking, spot and forward FX — normalized to the same all-in cost axis.',
    tag: 'live',
  },
  {
    id: 'fx-providers',
    title: 'FX providers',
    body: 'Licensed FX and payment institutions compared side by side with bank and stablecoin rails.',
    tag: 'live',
  },
  {
    id: 'stablecoin',
    title: 'Stablecoin',
    body: 'Fiat ↔ stablecoin, on/off-ramp and stable-to-stable hops in the sandbox graph.',
    tag: 'live',
  },
  {
    id: 'liquidity',
    title: 'Liquidity',
    body: 'Wholesale liquidity venues feeding multi-hop discovery — expanding in sandbox.',
    tag: 'soon',
  },
];

const TAG_VARIANT: Record<RailTag, 'recommend' | 'accent' | 'secondary'> = {
  live: 'recommend',
  soon: 'accent',
  planned: 'secondary',
};

const TAG_LABEL: Record<RailTag, string> = {
  live: 'Live',
  soon: 'Soon',
  planned: 'Planned',
};

/**
 * Rail class wall — status tags only, no customer logos (mockup batch 2/3).
 */
export function LandingRailsWall() {
  return (
    <SectionShell
      eyebrow="Rails"
      heading="Every rail class, on the same axes"
      subheading="Sandbox quotes today. Licensed partners settle — Meridian never holds funds or keys."
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {RAILS.map((rail) => (
          <li
            key={rail.id}
            className="marketing-surface marketing-surface-rail space-y-3 rounded-2xl p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{rail.title}</h3>
              <Badge variant={TAG_VARIANT[rail.tag]} className="text-[10px] uppercase">
                {TAG_LABEL[rail.tag]}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">{rail.body}</p>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}
