/**
 * Service identity, reported by the health and meta endpoints.
 *
 * `SERVICE_VERSION` versions the *HTTP contract*, not the deployed artefact: it is what a client
 * checks to know which request and response shapes it can rely on. The build being served is
 * identified by `engineVersion` and the pricing dataset version, both of which move independently.
 * Conflating the two would mean a patch release appearing to change the API contract.
 */
export const SERVICE_NAME = 'financial-router';
export const SERVICE_VERSION = '1.0.0';
