import { ConfigurationError } from '@meridian/core';
import { describe, expect, it } from 'vitest';
import { provisionStagingOperator } from './provision-staging-operator.js';

describe('provisionStagingOperator guards', () => {
  it('refuses to run unless DEPLOY_ENV=staging', async () => {
    await expect(
      provisionStagingOperator({
        DEPLOY_ENV: 'production',
        DATABASE_URL: 'postgres://unused',
        STAGING_OPERATOR_EMAIL: 'ops@staging.example.invalid',
        STAGING_OPERATOR_PASSWORD: 'a-unique-operator-password',
      }),
    ).rejects.toThrow(ConfigurationError);
  });

  it('rejects documented demo emails and passwords', async () => {
    await expect(
      provisionStagingOperator({
        DEPLOY_ENV: 'staging',
        DATABASE_URL: 'postgres://unused',
        STAGING_OPERATOR_EMAIL: 'treasury@demo-trading.example.invalid',
        STAGING_OPERATOR_PASSWORD: 'a-unique-operator-password',
      }),
    ).rejects.toThrow(/demo tenant/i);

    await expect(
      provisionStagingOperator({
        DEPLOY_ENV: 'staging',
        DATABASE_URL: 'postgres://unused',
        STAGING_OPERATOR_EMAIL: 'ops@staging.example.invalid',
        STAGING_OPERATOR_PASSWORD: 'MeridianDemo!2026',
      }),
    ).rejects.toThrow(/demo password/i);
  });
});
