import { describe, expect, it } from 'vitest';
import { safeDashboardPath } from './session-cookie';

describe('safeDashboardPath', () => {
  it('defaults to the overview', () => {
    expect(safeDashboardPath(undefined)).toBe('/dashboard');
    expect(safeDashboardPath('')).toBe('/dashboard');
  });

  it('allows nested dashboard routes', () => {
    expect(safeDashboardPath('/dashboard/quotes')).toBe('/dashboard/quotes');
  });

  it('rejects open redirects', () => {
    expect(safeDashboardPath('https://evil.example')).toBe('/dashboard');
    expect(safeDashboardPath('//evil.example')).toBe('/dashboard');
    expect(safeDashboardPath('/login')).toBe('/dashboard');
  });
});
