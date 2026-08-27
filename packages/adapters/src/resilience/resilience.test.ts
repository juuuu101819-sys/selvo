import {
  FixedClock,
  InvalidProviderQuoteError,
  ProviderError,
  ProviderTimeoutError,
  UnsupportedCurrencyError,
  ValidationError,
  noopLogger,
} from '@meridian/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryQuoteRecorder } from '../recording/in-memory-quote-recorder.js';
import { executeProviderCall, type ResilienceDependencies } from './execute.js';
import {
  DEFAULT_RESILIENCE_POLICY,
  backoffDelayMs,
  isRetryable,
  type ResiliencePolicy,
} from './policy.js';

/**
 * The clock advances on every read so that latency and the overall budget behave like real time
 * without the test having to wait. `sleep` advances it by the requested amount rather than actually
 * sleeping, which keeps the retry schedule assertable and the suite fast.
 */
class TickingClock extends FixedClock {
  constructor(
    start: string,
    private readonly tickMs = 1,
  ) {
    super(start);
  }

  override nowMs(): number {
    const now = super.nowMs();
    this.advance(this.tickMs);
    return now;
  }

  override nowIso(): string {
    return new Date(super.nowMs()).toISOString();
  }
}

/**
 * Tracks real elapsed time.
 *
 * The overall budget is accounted against the injected clock, while a per-attempt timeout is a real
 * timer. Those only agree when the clock tracks real time — which it does in production, and which
 * the budget tests below need in order to be meaningful rather than an artefact of a stubbed clock.
 */
class RealElapsedClock extends FixedClock {
  private readonly startedAt = Date.now();
  private readonly base: number;

  constructor(start: string) {
    super(start);
    this.base = super.nowMs();
  }

  override nowMs(): number {
    return this.base + (Date.now() - this.startedAt);
  }

  override nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }
}

const policy: ResiliencePolicy = {
  timeoutMs: 50,
  retry: {
    maxAttempts: 3,
    initialDelayMs: 10,
    maxDelayMs: 100,
    backoffMultiplier: 2,
    jitter: 0,
  },
  overallTimeoutMs: 5_000,
};

let recorder: InMemoryQuoteRecorder;
let slept: number[];
let deps: ResilienceDependencies;

beforeEach(() => {
  recorder = new InMemoryQuoteRecorder();
  slept = [];
  const clock = new TickingClock('2026-03-01T12:00:00.000Z');
  deps = {
    clock,
    logger: noopLogger,
    recorder,
    random: () => 0.5,
    sleep: (ms) => {
      slept.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    },
  };
});

function call<T>(
  execute: (context: { signal: AbortSignal; attempt: number }) => Promise<T>,
  overrides: Partial<ResiliencePolicy> = {},
) {
  return executeProviderCall<T>(
    {
      providerId: 'demo-fx-provider',
      capability: 'fx',
      operation: 'getFXQuote',
      request: { baseCurrency: 'USD', quoteCurrency: 'KRW', amountMinorUnits: '10000000' },
      policy: { ...policy, ...overrides },
      correlationId: 'req-1',
      execute,
      toRecord: (result) => ({ result: JSON.stringify(result) }),
    },
    deps,
  );
}

describe('successful calls', () => {
  it('returns the result on the first attempt', async () => {
    const outcome = await call(() => Promise.resolve({ rate: '1380' }));

    expect(outcome.result).toEqual({ rate: '1380' });
    expect(outcome.attempts).toBe(1);
    expect(slept).toEqual([]);
  });

  it('records the successful call with both timestamps', async () => {
    await call(() => Promise.resolve({ rate: '1380' }));
    const records = await recorder.list();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      providerId: 'demo-fx-provider',
      capability: 'fx',
      operation: 'getFXQuote',
      outcome: 'quoted',
      attempts: 1,
      correlationId: 'req-1',
    });
    expect(records[0]?.requestedAt).toMatch(/^2026-03-01T/);
    expect(records[0]?.receivedAt).toMatch(/^2026-03-01T/);
  });

  it('hands each attempt an abort signal', async () => {
    let seen: AbortSignal | null = null;
    await call(({ signal }) => {
      seen = signal;
      return Promise.resolve('ok');
    });

    expect(seen).not.toBeNull();
    expect(seen?.aborted).toBe(false);
  });
});

describe('timeout handling', () => {
  it('fails a call that never settles', async () => {
    await expect(call(() => new Promise(() => undefined))).rejects.toThrow(ProviderTimeoutError);
  });

  it('aborts the attempt so the adapter can stop work', async () => {
    let aborted = false;
    await expect(
      call(
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          }),
      ),
    ).rejects.toThrow();

    expect(aborted).toBe(true);
  });

  it('retries a timeout, since it may well succeed on a second ask', async () => {
    let attempts = 0;
    const outcome = await call(({ attempt }) => {
      attempts = attempt;
      return attempt < 3 ? new Promise(() => undefined) : Promise.resolve('ok');
    });

    expect(outcome.result).toBe('ok');
    expect(attempts).toBe(3);
  });

  /**
   * Per-attempt timeouts multiply: three attempts at four seconds is twelve seconds of waiting,
   * far longer than a caller comparing routes will tolerate. The budget is what stops one slow
   * provider setting the latency of the whole comparison.
   */
  it('stops at the overall budget rather than spending every attempt', async () => {
    deps = { ...deps, clock: new RealElapsedClock('2026-03-01T12:00:00.000Z') };

    await expect(
      call(() => new Promise(() => undefined), { overallTimeoutMs: 60, timeoutMs: 50 }),
    ).rejects.toThrow(ProviderTimeoutError);

    // The first attempt consumes 50ms of a 60ms budget, leaving no room to retry.
    const failures = (await recorder.list()).filter((record) => record.outcome === 'failed');
    expect(failures.length).toBeLessThan(policy.retry.maxAttempts);
  });

  it('shortens the final attempt to whatever budget remains', async () => {
    deps = { ...deps, clock: new RealElapsedClock('2026-03-01T12:00:00.000Z') };
    const started = Date.now();

    await expect(
      call(() => new Promise(() => undefined), { timeoutMs: 10_000, overallTimeoutMs: 40 }),
    ).rejects.toThrow(ProviderTimeoutError);

    // Would have waited ten seconds had the attempt not been clamped to the remaining budget.
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('retry handling', () => {
  it('retries a provider error and succeeds', async () => {
    const outcome = await call(({ attempt }) =>
      attempt === 1
        ? Promise.reject(new ProviderError('demo-fx-provider', 'upstream 503'))
        : Promise.resolve('recovered'),
    );

    expect(outcome.result).toBe('recovered');
    expect(outcome.attempts).toBe(2);
  });

  it('gives up after the configured number of attempts', async () => {
    let attempts = 0;
    await expect(
      call(() => {
        attempts += 1;
        return Promise.reject(new ProviderError('demo-fx-provider', 'still down'));
      }),
    ).rejects.toThrow(ProviderError);

    expect(attempts).toBe(3);
  });

  it('backs off exponentially between attempts', async () => {
    await expect(
      call(() => Promise.reject(new ProviderError('demo-fx-provider', 'down'))),
    ).rejects.toThrow();

    // 10ms then 20ms, with jitter disabled for the assertion.
    expect(slept).toEqual([10, 20]);
  });

  it('caps the delay so backoff cannot grow without bound', async () => {
    await expect(
      call(() => Promise.reject(new ProviderError('demo-fx-provider', 'down')), {
        retry: {
          maxAttempts: 4,
          initialDelayMs: 100,
          maxDelayMs: 150,
          backoffMultiplier: 10,
          jitter: 0,
        },
      }),
    ).rejects.toThrow();

    expect(slept).toEqual([100, 150, 150]);
  });

  describe('classification', () => {
    /**
     * Retrying a definite answer wastes the caller's latency budget and adds load to a provider
     * that has already told us something final.
     */
    it.each([
      ['an unsupported currency', new UnsupportedCurrencyError('XXX', ['USD'])],
      ['a malformed quote', new InvalidProviderQuoteError('demo-fx-provider', 'no rate')],
      ['a validation failure', new ValidationError('bad request')],
    ])('does not retry %s', async (_name, error) => {
      let attempts = 0;
      await expect(
        call(() => {
          attempts += 1;
          return Promise.reject(error);
        }),
      ).rejects.toThrow();

      expect(attempts).toBe(1);
      expect(slept).toEqual([]);
    });

    it('retries an unrecognised throw, which is usually a transport fault', async () => {
      let attempts = 0;
      await expect(
        call(() => {
          attempts += 1;
          return Promise.reject(new Error('ECONNRESET'));
        }),
      ).rejects.toThrow(ProviderError);

      expect(attempts).toBe(3);
    });

    it('classifies error codes directly', () => {
      expect(isRetryable(new ProviderTimeoutError('p', 100))).toBe(true);
      expect(isRetryable(new ProviderError('p', 'boom'))).toBe(true);
      expect(isRetryable(new ValidationError('bad'))).toBe(false);
      expect(isRetryable(new UnsupportedCurrencyError('XXX', []))).toBe(false);
    });
  });
});

describe('failure handling', () => {
  it('records every attempt, so a failure is evidenced as thoroughly as a success', async () => {
    await expect(
      call(() => Promise.reject(new ProviderError('demo-fx-provider', 'down'))),
    ).rejects.toThrow();

    const records = await recorder.list();
    expect(records).toHaveLength(3);
    expect(records.every((record) => record.outcome === 'failed')).toBe(true);
    expect(records[0]?.error).toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(records.map((record) => record.attempts).sort()).toEqual([1, 2, 3]);
  });

  it('normalises an unrecognised throw into a ProviderError, so callers can classify by code', async () => {
    await expect(call(() => Promise.reject(new Error('socket hang up')))).rejects.toThrow(
      /demo-fx-provider/,
    );
  });

  it('preserves a typed error rather than wrapping it', async () => {
    await expect(call(() => Promise.reject(new ValidationError('bad corridor')))).rejects.toThrow(
      ValidationError,
    );
  });

  it('records the request so the call can be reproduced', async () => {
    await expect(call(() => Promise.reject(new ValidationError('bad corridor')))).rejects.toThrow();

    const records = await recorder.list();
    expect(records[0]?.request).toEqual({
      baseCurrency: 'USD',
      quoteCurrency: 'KRW',
      amountMinorUnits: '10000000',
    });
  });
});

describe('backoffDelayMs', () => {
  it('grows exponentially from the initial delay', () => {
    const retry = {
      maxAttempts: 5,
      initialDelayMs: 100,
      maxDelayMs: 10_000,
      backoffMultiplier: 2,
      jitter: 0,
    };

    expect(backoffDelayMs(1, retry, () => 0.5)).toBe(100);
    expect(backoffDelayMs(2, retry, () => 0.5)).toBe(200);
    expect(backoffDelayMs(3, retry, () => 0.5)).toBe(400);
  });

  /**
   * Without jitter, every caller that failed at the same moment retries at the same moment, and a
   * provider recovering from a blip is knocked over again by the synchronised herd.
   */
  it('spreads retries either side of the delay when jitter is enabled', () => {
    const retry = {
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 1_000,
      backoffMultiplier: 2,
      jitter: 0.5,
    };

    expect(backoffDelayMs(1, retry, () => 0)).toBe(50);
    expect(backoffDelayMs(1, retry, () => 0.5)).toBe(100);
    expect(backoffDelayMs(1, retry, () => 1)).toBe(150);
  });

  it('never returns a negative delay', () => {
    const retry = {
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      jitter: 5,
    };

    expect(backoffDelayMs(1, retry, () => 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('defaults', () => {
  it('ships a bounded, jittered policy rather than unlimited retries', () => {
    expect(DEFAULT_RESILIENCE_POLICY.retry.maxAttempts).toBeLessThanOrEqual(5);
    expect(DEFAULT_RESILIENCE_POLICY.retry.jitter).toBeGreaterThan(0);
    expect(DEFAULT_RESILIENCE_POLICY.overallTimeoutMs).toBeGreaterThan(
      DEFAULT_RESILIENCE_POLICY.timeoutMs,
    );
  });

  it('records by default rather than silently discarding', async () => {
    const bare: ResilienceDependencies = {
      clock: new TickingClock('2026-03-01T12:00:00.000Z'),
      logger: noopLogger,
    };
    const spy = vi.spyOn(bare.logger, 'warn');

    await executeProviderCall(
      {
        providerId: 'p',
        capability: 'fx',
        operation: 'getFXQuote',
        request: {},
        policy,
        execute: () => Promise.resolve('ok'),
      },
      bare,
    );

    expect(spy).not.toHaveBeenCalled();
  });
});
