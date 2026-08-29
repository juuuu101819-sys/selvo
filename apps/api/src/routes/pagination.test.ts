import { encodeListCursor } from '@meridian/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestHarness,
  type ApiError,
  type TestHarness,
} from '../testing/harness.js';

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness();
});

afterAll(async () => {
  await harness.close();
});

const BODY = {
  sourceCurrency: 'USD',
  targetCurrency: 'KRW',
  amount: '100000.00',
};

async function createComparison(): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/comparisons',
    payload: BODY,
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { comparisonId: string; createdAt: string } }>().data.comparisonId;
}

describe('PA-M07 cursor pagination', () => {
  it('pages comparisons with a stable keyset and does not duplicate after an insert', async () => {
    const isolated = await createTestHarness();
    try {
      const create = async (): Promise<string> => {
        const response = await isolated.app.inject({
          method: 'POST',
          url: '/api/v1/comparisons',
          payload: BODY,
        });
        expect(response.statusCode).toBe(201);
        return response.json<{ data: { comparisonId: string } }>().data.comparisonId;
      };

      const first = await create();
      isolated.clock.advance(1000);
      const second = await create();
      isolated.clock.advance(1000);
      const third = await create();

      const page1 = await isolated.app.inject({
        method: 'GET',
        url: '/api/v1/comparisons?limit=2',
      });
      expect(page1.statusCode).toBe(200);
      const body1 = page1.json<{
        data: { comparisonId: string }[];
        meta: { limit: number; nextCursor: string | null };
      }>();
      expect(body1.meta.limit).toBe(2);
      expect(body1.data).toHaveLength(2);
      expect(body1.meta.nextCursor).toBeTruthy();
      const page1Ids = body1.data.map((row) => row.comparisonId);
      expect(page1Ids).toEqual([third, second]);

      isolated.clock.advance(60_000);
      const inserted = await create();

      const page2 = await isolated.app.inject({
        method: 'GET',
        url: `/api/v1/comparisons?limit=2&cursor=${encodeURIComponent(body1.meta.nextCursor ?? '')}`,
      });
      expect(page2.statusCode).toBe(200);
      const body2 = page2.json<{
        data: { comparisonId: string }[];
        meta: { nextCursor: string | null };
      }>();
      const page2Ids = body2.data.map((row) => row.comparisonId);
      expect(page2Ids).toEqual([first]);
      expect(page2Ids).not.toContain(inserted);
      expect(page2Ids.some((id) => page1Ids.includes(id))).toBe(false);
    } finally {
      await isolated.close();
    }
  });

  it('rejects an excessive limit rather than returning an unbounded page', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons?limit=101',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed cursor and a cursor for a missing row', async () => {
    const garbage = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons?cursor=not-a-cursor',
    });
    expect(garbage.statusCode).toBe(400);
    expect(garbage.json<ApiError>().error.code).toBe('VALIDATION_ERROR');

    const missing = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/comparisons?cursor=${encodeURIComponent(
        encodeListCursor({ sortAt: '2026-03-01T09:00:00.000Z', id: 'cmp_does_not_exist' }),
      )}`,
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<ApiError>().error.details['reason']).toBe('unknown_or_foreign_cursor');
  });

  it('rejects a tampered cursor whose timestamp does not match the row', async () => {
    const id = await createComparison();
    const tampered = encodeListCursor({
      sortAt: '1999-01-01T00:00:00.000Z',
      id,
    });
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/comparisons?cursor=${encodeURIComponent(tampered)}`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().error.details['reason']).toBe('tampered_cursor');
  });
});
