import { describe, expect, it } from 'vitest';
import { API_SCOPES, isApiScope, parseApiScopes } from './api-scope.js';

describe('API scopes', () => {
  it('names machine-caller rights including agent payment scopes, and nothing that would move money', () => {
    expect(API_SCOPES).toEqual([
      'quote:read',
      'route:read',
      'transaction:create',
      'payment:create',
      'payment:quote',
      'payment:authorize',
    ]);
    expect(isApiScope('quote:read')).toBe(true);
    expect(isApiScope('payment:authorize')).toBe(true);
    expect(isApiScope('execute')).toBe(false);
    expect(parseApiScopes(['route:read', 'quote:read', 'route:read', 'nope'])).toEqual([
      'route:read',
      'quote:read',
    ]);
  });
});
