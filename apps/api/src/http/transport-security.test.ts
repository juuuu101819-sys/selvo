import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createTestHarness } from '../testing/harness.js';
import { HSTS_HEADER_VALUE, shouldAttachHsts } from './transport-security.js';

const PRODUCTION_AUTH_SECRET = 'unit-test-production-auth-secret-ok';

describe('HSTS header', () => {
  it('attaches only when the process is production-locked', () => {
    expect(shouldAttachHsts(false)).toBe(false);
    expect(shouldAttachHsts(true)).toBe(true);
    expect(HSTS_HEADER_VALUE).toBe('max-age=31536000; includeSubDomains');
  });

  it('is omitted on the sandbox API', async () => {
    const harness = await createTestHarness();
    try {
      const health = await harness.app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.headers['strict-transport-security']).toBeUndefined();
    } finally {
      await harness.close();
    }
  });

  it('is present on a production-locked API and does not leak AUTH_SECRET', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PLATFORM_MODE: 'production',
      DATABASE_DRIVER: 'postgres',
      DATABASE_URL: 'postgres://meridian:meridian@127.0.0.1:5432/meridian_gate_test',
      AUTH_SECRET: PRODUCTION_AUTH_SECRET,
      LOG_LEVEL: 'silent',
    });
    const { app } = await createApp({ config });
    try {
      await app.ready();
      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.headers['strict-transport-security']).toBe(HSTS_HEADER_VALUE);
      expect(JSON.stringify(health.json())).not.toContain(PRODUCTION_AUTH_SECRET);
    } finally {
      await app.close();
    }
  });
});
