import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Unit tests for the web app's pure logic: formatting, quote-expiry classification, and the
 * dashboard session gate. Rendering and interaction are covered end to end by Playwright.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
    },
  },
  test: {
    name: 'web',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
