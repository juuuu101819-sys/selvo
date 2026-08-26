import { FixedClock, type AuditEvent } from '@meridian/core';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config/env.js';
import type { AppContainer } from '../container.js';

export interface TestHarness {
  readonly app: FastifyInstance;
  readonly container: AppContainer;
  readonly clock: FixedClock;
  readonly config: AppConfig;
  /** Reads the persisted audit trail, so assertions check what was stored, not what was rendered. */
  auditEvents(): Promise<readonly AuditEvent[]>;
  close(): Promise<void>;
}

/**
 * Builds the real application in-process against the in-memory persistence driver.
 *
 * Integration tests exercise the actual Fastify instance — routing, validation, error handling and
 * the full container wiring — via `app.inject`, so there is no HTTP server, no port and no
 * database to provision, and nothing between the test and the code that ships. The clock is fixed
 * so quote timestamps and fingerprints are stable assertions rather than moving targets.
 */
export async function createTestHarness(
  overrides: Partial<Record<string, string>> = {},
): Promise<TestHarness> {
  const config = loadConfig({
    NODE_ENV: 'test',
    PLATFORM_MODE: 'sandbox',
    DATABASE_DRIVER: 'memory',
    LOG_LEVEL: 'silent',
    ...overrides,
  });

  const clock = new FixedClock('2026-03-01T09:00:00.000Z');
  const { app, container } = await createApp({ config, clock });
  await app.ready();

  return {
    app,
    container,
    clock,
    config,
    auditEvents: () => container.persistence.auditLog.list({ limit: 500 }),
    close: () => app.close(),
  };
}

export interface ApiEnvelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

export interface ApiError {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details: Record<string, unknown>;
    readonly requestId: string;
  };
}
