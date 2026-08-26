import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

export const FINGERPRINT_ALGORITHM = 'sha256';

/**
 * Content hash of a comparison snapshot.
 *
 * Two comparisons with the same engine version, request, weights and provider quotes always
 * produce the same fingerprint, on any machine. That is what makes rule 13 (reproducible route
 * calculations) verifiable: `POST /v1/comparisons/:id/replay` recomputes this value and compares.
 */
export function fingerprint(value: unknown): string {
  return createHash(FINGERPRINT_ALGORITHM).update(canonicalJson(value), 'utf8').digest('hex');
}
