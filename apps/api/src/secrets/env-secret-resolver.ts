import { ConfigurationError, type SecretResolver } from '@meridian/core';

/**
 * Resolves provider credentials from the environment.
 *
 * Adapters ask for a secret by name and never touch `process.env` themselves, so swapping in a
 * vault or a cloud secret manager in Phase 3 is a change to this one class. Values are never
 * logged or included in error details — only the name of the missing variable is.
 */
export class EnvSecretResolver implements SecretResolver {
  constructor(private readonly source: NodeJS.ProcessEnv = process.env) {}

  get(name: string): string | null {
    const value = this.source[name];
    return value === undefined || value.trim() === '' ? null : value;
  }

  require(name: string): string {
    const value = this.get(name);
    if (value === null) {
      throw new ConfigurationError(`Required secret "${name}" is not configured.`, {
        variable: name,
      });
    }
    return value;
  }

  /** Credentials are namespaced per adapter: `PROVIDER_<UPPER_SNAKE_ID>_<KEY>`. */
  static variableNameFor(providerId: string, key: string): string {
    const normalised = providerId.replaceAll(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
    return `PROVIDER_${normalised}_${key.toUpperCase()}`;
  }
}
