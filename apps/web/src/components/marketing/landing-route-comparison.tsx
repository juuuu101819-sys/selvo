'use client';

import type { ReactNode } from 'react';
import { RouteFinderFormCard, RouteFinderResultsPanel } from '@/components/route-finder-panels';
import { useRouteFinder } from '@/components/use-route-finder';
import type { MetaDto } from '@/lib/api/types';

/**
 * Landing hero compare layout: form in the right column, results full-width below the 2-column grid.
 */
export function LandingRouteComparison({
  meta,
  children,
}: {
  meta: MetaDto;
  children: ReactNode;
}) {
  const controller = useRouteFinder({ meta, embedded: true, autoRun: false });

  return (
    <section className="space-y-8">
      <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-12">
        {children}
        <div className="min-w-0">
          <RouteFinderFormCard controller={controller} embedded />
        </div>
      </div>

      <div className="relative left-1/2 w-screen -translate-x-1/2 px-4 sm:px-6">
        <div className="mx-auto w-full max-w-7xl">
          <RouteFinderResultsPanel controller={controller} embedded />
        </div>
      </div>
    </section>
  );
}
