import type { ReactNode } from 'react';
import { DimensionalBg } from './dimensional-bg';

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <DimensionalBg />
      <div className="relative flex min-h-screen flex-col">{children}</div>
    </div>
  );
}
