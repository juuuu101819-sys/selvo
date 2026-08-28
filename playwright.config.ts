import { defineConfig, devices } from '@playwright/test';

const isCi = process.env['CI'] === 'true' || process.env['CI'] === '1';

const API_PORT = Number(process.env['E2E_API_PORT'] ?? 47_411);
const WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 43_217);

export const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
export const WEB_BASE_URL = `http://127.0.0.1:${WEB_PORT}`;

/**
 * End-to-end configuration.
 *
 * The suite starts its own API and web server on ports distinct from the development defaults, so a
 * run never collides with — or quietly tests against — a dev server someone already had open.
 * Persistence is the in-memory driver, which keeps the suite hermetic and means end-to-end needs no
 * database; the PostgreSQL path is covered by unit tests and, from Phase 2, by CI integration tests
 * against a real instance.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  ...(isCi ? { workers: 1 } : {}),
  reporter: isCi ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: WEB_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
      use: { baseURL: API_BASE_URL },
    },
    {
      name: 'web',
      testMatch: /.*\.web\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: /.*\.mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],

  webServer: [
    {
      command: 'npm run start --workspace @meridian/api',
      url: `${API_BASE_URL}/health`,
      reuseExistingServer: !isCi,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PLATFORM_MODE: 'sandbox',
        DATABASE_DRIVER: 'memory',
        API_PORT: String(API_PORT),
        API_HOST: '127.0.0.1',
        LOG_LEVEL: 'warn',
        CORS_ORIGINS: WEB_BASE_URL,
        SEED_DEMO_TENANTS: 'true',
      },
    },
    {
      command: 'npm run start --workspace @meridian/web',
      url: WEB_BASE_URL,
      reuseExistingServer: !isCi,
      timeout: 120_000,
      env: {
        NODE_ENV: 'production',
        WEB_PORT: String(WEB_PORT),
        API_BASE_URL,
        // HTTP e2e origin. PLATFORM_MODE is not production, so COOKIE_SECURE=false is allowed.
        COOKIE_SECURE: 'false',
      },
    },
  ],
});
