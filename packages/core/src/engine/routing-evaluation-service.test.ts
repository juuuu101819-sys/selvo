import { describe, expect, it } from 'vitest';
import { canAccessEvaluation } from './routing-evaluation-service.js';

describe('canAccessEvaluation', () => {
  it('allows public evaluations only when the route is public', () => {
    expect(
      canAccessEvaluation({ organizationId: null, allowPublic: true }, null),
    ).toBe(true);
    expect(
      canAccessEvaluation({ organizationId: null, allowPublic: false }, null),
    ).toBe(false);
  });

  it('scopes org evaluations to the matching tenant', () => {
    expect(
      canAccessEvaluation({ organizationId: 'org_a', allowPublic: false }, 'org_a'),
    ).toBe(true);
    expect(
      canAccessEvaluation({ organizationId: 'org_b', allowPublic: true }, 'org_a'),
    ).toBe(false);
    expect(
      canAccessEvaluation({ organizationId: null, allowPublic: true }, 'org_a'),
    ).toBe(false);
  });
});
