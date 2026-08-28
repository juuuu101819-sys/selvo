import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function read(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

describe('CI hardening (PA-H11, PA-H12)', () => {
  const workflow = read('.github/workflows/ci.yml');
  const dockerfile = read('Dockerfile');
  const dockerignore = read('.dockerignore');
  const pkg = JSON.parse(read('package.json')) as {
    readonly scripts: Record<string, string>;
    readonly overrides?: { readonly 'deepmerge-ts'?: string };
  };

  it('runs lockfile-pinned install, verify, e2e, production build, audit, and container build', () => {
    expect(workflow).toMatch(/npm ci/);
    expect(workflow).not.toMatch(/npm install(?:\s|$)/);
    expect(workflow).toContain('npm run lint');
    expect(workflow).toContain('npm run typecheck');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('npm run test:e2e');
    expect(workflow).toContain('npm run audit:deps');
    expect(workflow).toMatch(/docker build/);
    expect(workflow).toContain('docker-compose.staging.yml');
    expect(workflow).toContain('npm run test:staging-smoke');
    expect(workflow).toContain('docker compose -f docker-compose.staging.yml run --rm migrate');
    expect(workflow).toContain('needs: [verify, container]');
    expect(workflow).not.toMatch(/continue-on-error:\s*true/);
  });

  it('fails the dependency audit on moderate-or-higher advisories', () => {
    expect(pkg.scripts['audit:deps']).toContain('npm audit');
    expect(pkg.scripts['audit:deps']).toContain('--audit-level=moderate');
  });

  it('pins patched deepmerge-ts until Prisma ships the upstream bump', () => {
    expect(pkg.overrides?.['deepmerge-ts']).toBe('8.0.2');
  });

  it('builds a production image from fail-closed gates with no baked demo secrets', () => {
    expect(dockerfile).toMatch(/NODE_ENV=production/);
    expect(dockerfile).toMatch(/PLATFORM_MODE=production/);
    expect(dockerfile).toMatch(/DATABASE_DRIVER=postgres/);
    expect(dockerfile).toMatch(/PRODUCTION_ROUTING_AVAILABLE=false/);
    expect(dockerfile).toMatch(/PRODUCTION_EXECUTION_AVAILABLE=false/);
    expect(dockerfile).toMatch(/SEED_DEMO_TENANTS=false/);
    expect(dockerfile).not.toMatch(/AUTH_SECRET=/);
    expect(dockerfile).not.toMatch(/DATABASE_URL=/);
    expect(dockerfile).not.toMatch(/MeridianDemo/);
    expect(dockerfile).not.toMatch(/mag_demo_agent01/);
    expect(dockerfile).not.toMatch(/PRODUCTION_ROUTING_AVAILABLE=true/);
    expect(dockerfile).not.toMatch(/PRODUCTION_EXECUTION_AVAILABLE=true/);
    expect(dockerfile).not.toMatch(/SEED_DEMO_TENANTS=true/);
    expect(dockerignore).toContain('.env');
  });

  it('defines a staging compose stack that injects secrets and does not bake them', () => {
    const compose = read('docker-compose.staging.yml');
    expect(compose).toContain('DEPLOY_ENV: staging');
    expect(compose).toContain('PLATFORM_MODE: production');
    expect(compose).toContain('DATABASE_DRIVER: postgres');
    expect(compose).toContain("PRODUCTION_ROUTING_AVAILABLE: 'false'");
    expect(compose).toContain("PRODUCTION_EXECUTION_AVAILABLE: 'false'");
    expect(compose).toContain("SEED_DEMO_TENANTS: 'false'");
    expect(compose).toContain('STAGING_AUTH_SECRET:?');
    expect(compose).toContain('STAGING_DB_PASSWORD:?');
    expect(compose).toContain('127.0.0.1:47331:47311');
    expect(compose).toMatch(/healthcheck:/);
    expect(compose).not.toMatch(/MeridianDemo/);
    expect(compose).not.toMatch(/mag_demo_agent01/);
    expect(compose).not.toMatch(/AUTH_SECRET:\s*['"]?[a-zA-Z0-9]{16,}/);
    expect(read('.env.staging.example')).toMatch(/STAGING_AUTH_SECRET=/);
    expect(read('.env.staging.example')).not.toMatch(/MeridianDemo/);
  });
});
