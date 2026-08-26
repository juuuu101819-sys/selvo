import { isAppError } from '@meridian/core';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';

/**
 * Process entrypoint.
 *
 * Configuration is validated before anything is constructed, so a bad deployment fails here rather
 * than halfway through serving traffic. Shutdown drains the HTTP server and closes the persistence
 * pool, which matters for the PostgreSQL driver.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { app } = await createApp({ config });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Failed to shut down cleanly');
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    {
      mode: config.mode,
      url: `http://${config.host}:${config.port}`,
      persistenceDriver: config.database.driver,
    },
    'Meridian API listening',
  );
}

main().catch((error: unknown) => {
  const detail = isAppError(error)
    ? { code: error.code, message: error.message, details: error.details }
    : { message: error instanceof Error ? error.message : String(error) };
  // The logger does not exist yet if configuration failed, so this is the one place a direct
  // write to stderr is the right call.
  process.stderr.write(`Failed to start Meridian API: ${JSON.stringify(detail, null, 2)}\n`);
  process.exit(1);
});
