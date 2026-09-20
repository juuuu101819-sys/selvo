import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function SectionShell({
  eyebrow,
  heading,
  subheading,
  children,
  className,
}: {
  eyebrow?: string;
  heading: string;
  subheading?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-8', className)}>
      <div className="max-w-2xl space-y-2">
        {eyebrow !== undefined && (
          <p className="text-accent text-xs font-semibold tracking-widest uppercase">{eyebrow}</p>
        )}
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h2>
        {subheading !== undefined && (
          <p className="text-muted-foreground text-sm sm:text-base">{subheading}</p>
        )}
      </div>
      {children}
    </section>
  );
}
