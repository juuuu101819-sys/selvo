'use client';

import { RouteFinderFormCard, RouteFinderResultsPanel } from '@/components/route-finder-panels';
import { useRouteFinder } from '@/components/use-route-finder';
import type { MetaDto } from '@/lib/api/types';

export function RouteFinder({ meta, embedded = false }: { meta: MetaDto; embedded?: boolean }) {
  const controller = useRouteFinder({ meta, embedded, autoRun: embedded });

  return (
    <div className="space-y-6">
      <RouteFinderFormCard controller={controller} embedded={embedded} />
      {embedded && !controller.showResultsPanel ? null : (
        <RouteFinderResultsPanel controller={controller} embedded={embedded} />
      )}
    </div>
  );
}
