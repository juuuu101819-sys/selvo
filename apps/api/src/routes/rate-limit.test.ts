import { describe, expect, it } from 'vitest';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type ApiError } from '../testing/harness.js';

describe('rate limiting', () => {
  it('returns 429 once the window is exhausted', async () => {
    const harness = await createTestHarness({ RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000' });
    try {
      const first = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/assets` });
      const second = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/assets` });
      const third = await harness.app.inject({ method: 'GET', url: `${API_V1_PREFIX}/assets` });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(third.statusCode).toBe(429);
      expect(third.json<ApiError>().error.code).toBe('RATE_LIMITED');
      expect(third.headers['retry-after']).toBeDefined();
    } finally {
      await harness.close();
    }
  });
});
