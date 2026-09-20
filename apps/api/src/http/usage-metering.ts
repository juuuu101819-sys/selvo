import type { BillableAction } from '@meridian/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContainer } from '../container.js';
import { principalOf } from './authentication.js';

/**
 * Per-request usage metering (§18.1).
 *
 * The map below is the billable surface, and it is deliberately an allow-list rather than "every
 * route that is not excluded": a new endpoint is unbilled until someone decides what it costs,
 * which is the failure direction that does not surprise a customer with a charge.
 *
 * Absent from the map, and intentionally so:
 *
 *   * Execution-intent generation. It is an API call, but it is billed as `FLAT_DECISION`, and
 *     metering it too is the double charge §18.6 forbids.
 *   * Dashboard, audit, ops, and auth routes. Reading your own invoice is not a billable act.
 */
const METERED_ROUTES: ReadonlyMap<string, BillableAction> = new Map([
  ['POST /quote', 'quote.read'],
  ['POST /comparisons', 'quote.read'],
  ['POST /provider-quotes', 'quote.read'],
  ['POST /routes', 'route.search'],
  ['POST /route-graph/paths', 'route.search'],
  ['POST /stablecoin-routes', 'route.search'],
  ['POST /defi-routes', 'route.search'],
  ['GET /defi-liquidity', 'liquidity.inspect'],
  ['GET /executions/:id', 'settlement.status'],
  ['GET /reconciliation/mismatches', 'reconciliation.report'],
]);

/** The billable action for a handled route, or null when the route is not metered. */
export function meteredActionFor(
  method: string,
  routePattern: string | undefined,
): BillableAction | null {
  if (routePattern === undefined) {
    return null;
  }
  // Fastify reports the mounted path, which carries the version prefix. Metering is about the
  // logical endpoint, so /api/v1/quote and /v1/quote are the same billable action.
  const path = routePattern.replace(/^\/(api\/v1|v1)/, '');
  return METERED_ROUTES.get(`${method.toUpperCase()} ${path}`) ?? null;
}

/**
 * Count successful metered calls against the caller's organization.
 *
 * Runs `onResponse`, after the customer already has their answer, and only for 2xx replies: a
 * request that failed produced nothing worth charging for. An anonymous caller has no
 * organization to bill and is skipped.
 */
export function registerUsageMetering(app: FastifyInstance, container: AppContainer): void {
  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    if (reply.statusCode < 200 || reply.statusCode >= 300) {
      return;
    }
    const action = meteredActionFor(request.method, request.routeOptions.url);
    if (action === null) {
      return;
    }
    const { organizationId } = principalOf(request);
    if (organizationId === null) {
      return;
    }
    await container.usageMetering.record({ organizationId, action });
  });
}
