'use client';

import type { MetaDto } from '@/lib/api/types';
import { RouteFinder } from '@/components/route-finder';

/** Hero route-search card — wraps the live comparison form. */
export function RoutingViz({ meta }: { meta: MetaDto }) {
  return (
    <div className="overflow-hidden">
      <RouteFinder meta={meta} embedded />
    </div>
  );
}
