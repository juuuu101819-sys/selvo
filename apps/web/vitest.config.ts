import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the web app's pure logic: formatting and quote-expiry classification. Rendering
 * and interaction are covered end to end by Playwright; these exist because financial formatting
 * and expiry states are contracts, and a contract deserves a faster failure than a browser run.
 */
export default defineConfig({
  test: {
    name: 'web',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
