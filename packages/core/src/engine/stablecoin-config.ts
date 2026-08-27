/**
 * Version of the *stablecoin* routing layer's calculation and quote-projection semantics.
 *
 * Independent of comparison `ENGINE_VERSION` (2.0.0), multi-rail `ROUTING_ENGINE_VERSION` (1.0.0)
 * and the route graph. Bump this when a change would alter stablecoin quotes for an unchanged
 * catalog. Do not bump those other engines from here.
 */
export const STABLECOIN_ROUTING_ENGINE_VERSION = '1.0.0';
