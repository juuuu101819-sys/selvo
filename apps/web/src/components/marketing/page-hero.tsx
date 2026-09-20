import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHero({
  eyebrow,
  title,
  lede,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  lede: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('max-w-3xl space-y-4', className)}>
      {eyebrow ? (
        <p className="text-accent text-xs font-semibold tracking-widest uppercase">{eyebrow}</p>
      ) : null}
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">{lede}</p>
      {children}
    </header>
  );
}
