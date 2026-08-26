import type { LogContext, Logger } from '@meridian/core';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Adapts Fastify's pino logger to the domain `Logger` port.
 *
 * The domain emits an event name plus a context object and never formats a string, so logs stay
 * queryable. Binding a child logger per request means every line from a comparison carries its
 * request id without any call site having to remember to pass it.
 */
export class PinoLoggerAdapter implements Logger {
  constructor(private readonly pino: FastifyBaseLogger) {}

  debug(message: string, context: LogContext = {}): void {
    this.pino.debug(context, message);
  }

  info(message: string, context: LogContext = {}): void {
    this.pino.info(context, message);
  }

  warn(message: string, context: LogContext = {}): void {
    this.pino.warn(context, message);
  }

  error(message: string, context: LogContext = {}): void {
    this.pino.error(context, message);
  }

  child(bindings: LogContext): Logger {
    return new PinoLoggerAdapter(this.pino.child(bindings));
  }
}
