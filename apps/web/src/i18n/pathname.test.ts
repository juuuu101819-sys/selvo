import { describe, expect, it } from 'vitest';
import {
  isDashboardPath,
  localeFromPathname,
  loginPathFor,
  stripLocalePrefix,
  withLocalePrefix,
} from './pathname';

describe('locale pathnames', () => {
  it('strips non-default prefixes including region codes', () => {
    expect(stripLocalePrefix('/')).toBe('/');
    expect(stripLocalePrefix('/dashboard')).toBe('/dashboard');
    expect(stripLocalePrefix('/ko')).toBe('/');
    expect(stripLocalePrefix('/ko/dashboard/quotes')).toBe('/dashboard/quotes');
    expect(stripLocalePrefix('/zh-CN/terms')).toBe('/terms');
    expect(stripLocalePrefix('/pt-BR/privacy')).toBe('/privacy');
  });

  it('does not treat /en as a prefix to strip (as-needed English)', () => {
    expect(stripLocalePrefix('/en')).toBe('/en');
    expect(localeFromPathname('/en/dashboard')).toBe('en');
  });

  it('round-trips locale prefixes', () => {
    expect(withLocalePrefix('/dashboard', 'en')).toBe('/dashboard');
    expect(withLocalePrefix('/', 'ko')).toBe('/ko');
    expect(withLocalePrefix('/terms', 'ja')).toBe('/ja/terms');
    expect(localeFromPathname('/zh-CN/dashboard')).toBe('zh-CN');
  });

  it('detects dashboard routes behind a locale prefix', () => {
    expect(isDashboardPath('/dashboard')).toBe(true);
    expect(isDashboardPath('/ko/dashboard/settings')).toBe(true);
    expect(isDashboardPath('/ko/login')).toBe(false);
    expect(isDashboardPath('/terms')).toBe(false);
  });

  it('points sign-in at the matching locale', () => {
    expect(loginPathFor('/dashboard')).toBe('/login');
    expect(loginPathFor('/ko/dashboard/quotes')).toBe('/ko/login');
  });
});
