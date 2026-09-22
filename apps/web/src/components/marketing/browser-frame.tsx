import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function BrowserFrame({
  url,
  children,
  className,
}: {
  url: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('marketing-surface overflow-hidden rounded-2xl', className)}>
      <div className="border-border/60 bg-secondary/30 flex items-center gap-2 border-b px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-destructive/80" aria-hidden />
        <span className="size-2.5 rounded-full bg-accent/80" aria-hidden />
        <span className="size-2.5 rounded-full bg-recommend/80" aria-hidden />
        <p className="text-muted-foreground ml-2 flex-1 truncate rounded-md bg-background/60 px-3 py-1 font-mono text-[11px]">
          {url}
        </p>
      </div>
      {children}
    </div>
  );
}
