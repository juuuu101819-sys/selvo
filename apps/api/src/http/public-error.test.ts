import Fastify from 'fastify';
import { InternalError, PersistenceError, ProviderError, ValidationError } from '@meridian/core';
import { describe, expect, it } from 'vitest';
import { registerErrorHandling } from './errors.js';
import { toPublicErrorResponse } from './public-error.js';

describe('PA-M03 public error DTO', () => {
  it('hides a Prisma-shaped failure: no stack, no SQL, no P-code, no table names', () => {
    const prisma = Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: { modelName: 'User', target: ['email'] },
      name: 'PrismaClientKnownRequestError',
    });
    const mapped = toPublicErrorResponse(prisma, 'req_prisma');
    expect(mapped).toEqual({
      status: 500,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
          details: {},
          requestId: 'req_prisma',
        },
      },
    });
    const serialized = JSON.stringify(mapped.body);
    expect(serialized).not.toContain('P2002');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('User');
    expect(serialized).not.toContain('Prisma');
    expect(serialized).not.toContain('stack');
  });

  it('hides an upstream provider payload: no response body, no tokens', () => {
    const provider = Object.assign(new Error('upstream exploded'), {
      response: { data: { token: 'sk_live_abc', authorization: 'Bearer xyz' } },
    });
    const mapped = toPublicErrorResponse(provider, 'req_provider');
    expect(mapped.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        details: {},
        requestId: 'req_provider',
      },
    });
    const serialized = JSON.stringify(mapped.body);
    expect(serialized).not.toContain('sk_live');
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('upstream exploded');
  });

  it('rewrites ProviderError messages that would otherwise echo the adapter', () => {
    const mapped = toPublicErrorResponse(
      new ProviderError('sandbox-northgate-bank', '{"token":"sk_live_abc"}'),
      'req_pe',
    );
    expect(mapped.status).toBe(502);
    expect(mapped.body).toEqual({
      error: {
        code: 'PROVIDER_ERROR',
        message: 'An upstream provider failed. Retry later.',
        details: { providerId: 'sandbox-northgate-bank' },
        requestId: 'req_pe',
      },
    });
    expect(JSON.stringify(mapped.body)).not.toContain('sk_live');
  });

  it('does not send InternalError.message or PersistenceError store detail', () => {
    expect(toPublicErrorResponse(new InternalError('boom at /opt/meridian/app.js:12'), 'req_i').body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      details: {},
      requestId: 'req_i',
    });
    expect(
      toPublicErrorResponse(new PersistenceError('Failed to persist comparison cmp_1.', { table: 'comparisons' }), 'req_db')
        .body.error,
    ).toEqual({
      code: 'PERSISTENCE_ERROR',
      message: 'The data store is temporarily unavailable.',
      details: {},
      requestId: 'req_db',
    });
  });

  it('keeps designed validation information', () => {
    const mapped = toPublicErrorResponse(
      new ValidationError('amount must be a decimal string.', { field: 'amount' }),
      'req_v',
    );
    expect(mapped.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'amount must be a decimal string.',
      details: { field: 'amount' },
      requestId: 'req_v',
    });
  });

  it('maps Fastify 4xx parser wording to a generic validation DTO', () => {
    const mapped = toPublicErrorResponse(
      Object.assign(new Error('Unexpected token } in JSON at position 12'), { statusCode: 400 }),
      'req_fastify',
    );
    expect(mapped).toEqual({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request could not be completed.',
          details: {},
          requestId: 'req_fastify',
        },
      },
    });
    expect(JSON.stringify(mapped.body)).not.toContain('Unexpected token');
  });
});

describe('PA-M03 error handler over HTTP', () => {
  it('returns the canonical DTO for a Prisma throw and a provider throw', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandling(app);
    app.get('/boom-prisma', async () => {
      throw Object.assign(new Error('select * from api_keys where id = $1'), {
        code: 'P2022',
        clientVersion: '7.10.0',
        meta: { column: 'secret_hash' },
        name: 'PrismaClientKnownRequestError',
      });
    });
    app.get('/boom-provider', async () => {
      throw Object.assign(new Error('adapter 502'), {
        response: { data: { access_token: 'tok_live', raw: { stack: 'at Adapter.quote' } } },
      });
    });
    await app.ready();

    const prismaResponse = await app.inject({ method: 'GET', url: '/boom-prisma' });
    expect(prismaResponse.statusCode).toBe(500);
    expect(prismaResponse.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        details: {},
        requestId: prismaResponse.json<{ error: { requestId: string } }>().error.requestId,
      },
    });
    expect(prismaResponse.body).not.toContain('api_keys');
    expect(prismaResponse.body).not.toContain('P2022');
    expect(prismaResponse.body).not.toContain('secret_hash');

    const providerResponse = await app.inject({ method: 'GET', url: '/boom-provider' });
    expect(providerResponse.statusCode).toBe(500);
    expect(providerResponse.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        details: {},
        requestId: providerResponse.json<{ error: { requestId: string } }>().error.requestId,
      },
    });
    expect(providerResponse.body).not.toContain('tok_live');
    expect(providerResponse.body).not.toContain('Adapter.quote');
    expect(providerResponse.body).not.toContain('access_token');

    await app.close();
  });
});
