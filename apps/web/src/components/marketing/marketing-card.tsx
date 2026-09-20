import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function MarketingCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border-border/60 marketing-surface rounded-2xl border p-5 sm:p-6', className)}>
      {children}
    </div>
  );
}
