import { MarketingCard } from './marketing-card';

export function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <MarketingCard className="marketing-surface-feature h-full space-y-2">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
    </MarketingCard>
  );
}
