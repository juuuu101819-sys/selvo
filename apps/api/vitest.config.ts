import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Integration tests build the whole app in-process; give them room without being generous.
    testTimeout: 15_000,
  },
});
