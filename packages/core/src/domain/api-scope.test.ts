import { describe, expect, it } from 'vitest';
import {
  API_SCOPES,
  DEFAULT_AGENT_SCOPES,
  ORGANIZATION_API_KEY_SCOPES,
  ORGANIZATION_SESSION_ROLES,
  SESSION_API_SCOPES,
  SESSION_SCOPES_BY_ROLE,
  isApiScope,
  parseApiScopes,
  sessionScopesForRole,
  type ApiScope,
  type OrganizationSessionRole,
} from './api-scope.js';

const PAYMENT_SCOPES: readonly ApiScope[] = ['payment:create', 'payment:quote', 'payment:authorize'];

describe('API scopes', () => {
  it('names machine-caller rights including agent payment and policy-write scopes, and nothing that would move money', () => {
    expect(API_SCOPES).toEqual([
      'quote:read',
      'route:read',
      'transaction:create',
      'payment:create',
      'payment:quote',
      'payment:authorize',
      'agent_policy:write',
    ]);
    expect(isApiScope('quote:read')).toBe(true);
    expect(isApiScope('payment:authorize')).toBe(true);
    expect(isApiScope('agent_policy:write')).toBe(true);
    expect(isApiScope('execute')).toBe(false);
    expect(parseApiScopes(['route:read', 'quote:read', 'route:read', 'nope'])).toEqual([
      'route:read',
      'quote:read',
    ]);
  });

  it('issues the exact minimal session scope set for each organization role', () => {
    const expected: Record<OrganizationSessionRole, readonly ApiScope[]> = {
      viewer: ['quote:read', 'route:read'],
      member: ['quote:read', 'route:read'],
      admin: ['quote:read', 'route:read', 'agent_policy:write'],
      owner: ['quote:read', 'route:read', 'agent_policy:write'],
    };

    expect([...ORGANIZATION_SESSION_ROLES].sort()).toEqual(
      (Object.keys(expected) as OrganizationSessionRole[]).sort(),
    );

    for (const role of ORGANIZATION_SESSION_ROLES) {
      expect(SESSION_SCOPES_BY_ROLE[role]).toEqual(expected[role]);
      expect(sessionScopesForRole(role)).toEqual(expected[role]);
      expect(sessionScopesForRole(role)).not.toContain('transaction:create');
      for (const payment of PAYMENT_SCOPES) {
        expect(sessionScopesForRole(role)).not.toContain(payment);
      }
    }

    expect(sessionScopesForRole('unknown-role')).toEqual(expected.viewer);
    expect(SESSION_API_SCOPES).toEqual(['quote:read', 'route:read', 'agent_policy:write']);
    expect(SESSION_API_SCOPES).not.toContain('transaction:create');
  });

  it('keeps payment scopes on agent credentials and transaction:create on minted organization keys', () => {
    expect(DEFAULT_AGENT_SCOPES).toEqual([
      'quote:read',
      'payment:create',
      'payment:quote',
      'payment:authorize',
    ]);
    expect(DEFAULT_AGENT_SCOPES).not.toContain('agent_policy:write');
    expect(DEFAULT_AGENT_SCOPES).not.toContain('transaction:create');
    expect(ORGANIZATION_API_KEY_SCOPES).toEqual(['quote:read', 'route:read', 'transaction:create']);
    expect(ORGANIZATION_API_KEY_SCOPES).not.toContain('agent_policy:write');
    for (const payment of PAYMENT_SCOPES) {
      expect(ORGANIZATION_API_KEY_SCOPES).not.toContain(payment);
    }
  });
});
