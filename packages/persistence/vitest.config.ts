import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'persistence',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
