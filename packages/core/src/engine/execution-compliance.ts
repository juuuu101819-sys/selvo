import { ValidationError } from '../errors/index.js';
import {
  isComplianceOutcome,
  type ComplianceOutcome,
} from '../domain/execution-orchestration.js';

/**
 * Phase-2 sandbox compliance gate.
 *
 * Fail-closed: an unknown outcome is deny. Live/production screening is not implemented.
 * `review` parks the orchestration; it does not dispatch.
 */
export function evaluateSandboxCompliance(outcome: string | undefined): ComplianceOutcome {
  if (outcome === undefined) {
    return 'pass';
  }
  if (!isComplianceOutcome(outcome)) {
    throw new ValidationError('Unknown compliance outcome.', {
      failClosed: true,
      reason: 'unknown_compliance_outcome',
      outcome,
    });
  }
  return outcome;
}
