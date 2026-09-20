import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

export function PageCta({
  title,
  body,
  primaryLabel,
  primaryHref,
  secondaryLabel,
  secondaryHref,
}: {
  title: string;
  body: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}) {
  return (
    <div
      className="marketing-surface rounded-2xl p-8 sm:p-10"
      style={{
        backgroundImage:
          'linear-gradient(135deg, color-mix(in oklch, var(--primary) 18%, transparent), color-mix(in oklch, var(--accent) 10%, transparent))',
      }}
    >
      <div className="mx-auto max-w-2xl space-y-4 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">{body}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button nativeButton={false} render={<Link href={primaryHref} />}>
            {primaryLabel}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
          {secondaryLabel && secondaryHref ? (
            <Button variant="outline" nativeButton={false} render={<Link href={secondaryHref} />}>
              {secondaryLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
