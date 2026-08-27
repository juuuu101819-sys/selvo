/**
 * Version of the DeFi liquidity routing layer's calculation and projection semantics.
 *
 * Independent of comparison `ENGINE_VERSION` (2.0.0), multi-rail `ROUTING_ENGINE_VERSION` (1.0.0),
 * the route graph, and the stablecoin layer. Bump this when a change would alter DeFi-layer quotes
 * for an unchanged catalog. Do not bump those other engines from here.
 */
export const DEFI_ROUTING_ENGINE_VERSION = '1.0.0';
