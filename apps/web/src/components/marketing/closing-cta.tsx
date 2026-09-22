import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

/**
 * Final gradient CTA band — mockup batch 3/3.
 */
export function ClosingCta() {
  return (
    <div
      className="marketing-surface relative overflow-hidden rounded-2xl p-8 sm:p-12"
      style={{
        backgroundImage:
          'linear-gradient(135deg, color-mix(in oklch, var(--primary) 24%, transparent), color-mix(in oklch, var(--accent) 14%, transparent) 48%, color-mix(in oklch, var(--recommend) 10%, transparent))',
      }}
    >
      <div className="relative z-10 mx-auto max-w-2xl space-y-5 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
          Start ranking routes today
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
          Sandbox is free. Non-custodial — never holds funds or keys. POST /executions stays 501;
          licensed partners settle.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button nativeButton={false} render={<Link href="/login" />}>
            Start in the sandbox
            <ArrowRight className="size-4" aria-hidden />
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/developers" />}>
            Read the docs
          </Button>
        </div>
      </div>
    </div>
  );
}
