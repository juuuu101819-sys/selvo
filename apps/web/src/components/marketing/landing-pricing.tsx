import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { SectionShell } from './section-shell';

const TIERS = [
  {
    id: 'api',
    name: 'API',
    price: '$0.01',
    unit: 'per comparison',
    body: 'Pay as you go for route decisions. Priced on usage — never a spread markup.',
    highlight: false,
  },
  {
    id: 'saas',
    name: 'SaaS',
    price: '$499',
    unit: '/ month',
    body: 'Team dashboard, quote history and corridor tooling in sandbox.',
    highlight: true,
  },
  {
    id: 'data',
    name: 'Data',
    price: 'Custom',
    unit: '',
    body: 'Reference rates, dataset versions and reproducibility exports — priced on scope.',
    highlight: false,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$999',
    unit: '/ month',
    body: 'SSO roadmap, custom corridors and partner onboarding support.',
    highlight: false,
  },
] as const;

/**
 * Illustrative pricing tiers — demo figures from the approved mockup.
 */
export function LandingPricing() {
  return (
    <SectionShell
      eyebrow="Pricing"
      heading="Usage-based decision layer pricing"
      subheading="Illustrative pricing — final rates confirmed at launch. Sandbox is free."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => (
          <article
            key={tier.id}
            className={`marketing-surface marketing-surface-feature flex flex-col rounded-2xl p-5 ${
              tier.highlight ? 'ring-primary/40 ring-1' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold">{tier.name}</h3>
              <Badge variant="secondary" className="text-[10px] uppercase">
                Illustrative
              </Badge>
            </div>
            <p className="font-display mt-3 text-2xl font-semibold tabular-nums">
              {tier.price}
              <span className="text-muted-foreground text-sm font-normal">{tier.unit}</span>
            </p>
            <p className="text-muted-foreground mt-3 flex-1 text-sm leading-relaxed">{tier.body}</p>
          </article>
        ))}
      </div>

      <div className="marketing-surface rounded-xl p-4 sm:p-5">
        <p className="text-muted-foreground text-sm leading-relaxed">
          Illustrative pricing only — rates confirmed at launch. Sandbox is free. Meridian charges for
          the decision layer per comparison, never spread markup. Non-custodial: we never hold funds or
          keys.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          nativeButton={false}
          render={<Link href="/pricing" />}
        >
          View full pricing page
        </Button>
      </div>
    </SectionShell>
  );
}
