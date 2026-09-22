'use client';

import type { MetaDto } from '@/lib/api/types';
import { LandingRouteComparison } from '@/components/marketing/landing-route-comparison';
import type { ReactNode } from 'react';

/** Hero route-search — form in grid, results full-width below. */
export function RoutingViz({ meta, hero }: { meta: MetaDto; hero: ReactNode }) {
  return <LandingRouteComparison meta={meta}>{hero}</LandingRouteComparison>;
}
