import { describe, expect, it } from 'vitest';
import { HSTS_HEADER_VALUE, shouldAttachHsts } from './transport-security';

describe('shouldAttachHsts', () => {
  it('is off for local sandbox development', () => {
    expect(shouldAttachHsts({ NODE_ENV: 'development', PLATFORM_MODE: 'sandbox' })).toBe(false);
  });

  it('is on when PLATFORM_MODE=production', () => {
    expect(shouldAttachHsts({ NODE_ENV: 'development', PLATFORM_MODE: 'production' })).toBe(true);
  });

  it('is on for NODE_ENV=production deploys', () => {
    expect(shouldAttachHsts({ NODE_ENV: 'production' })).toBe(true);
  });

  it('stays off for the HTTP Playwright server', () => {
    expect(
      shouldAttachHsts({
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
      }),
    ).toBe(false);
  });

  it('cannot be disabled once PLATFORM_MODE=production', () => {
    expect(
      shouldAttachHsts({
        NODE_ENV: 'production',
        PLATFORM_MODE: 'production',
        COOKIE_SECURE: 'false',
      }),
    ).toBe(true);
  });

  it('uses a one-year includeSubDomains policy', () => {
    expect(HSTS_HEADER_VALUE).toBe('max-age=31536000; includeSubDomains');
  });
});
