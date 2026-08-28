import { describe, expect, it } from 'vitest';
import { consumeFixedWindow } from './fixed-window.js';

describe('consumeFixedWindow', () => {
  it('allows up to the limit and then returns retry-after', () => {
    const first = consumeFixedWindow(undefined, { key: 'k', limit: 2, windowMs: 60_000, nowMs: 1_000 });
    expect(first.result.allowed).toBe(true);
    const second = consumeFixedWindow(first.bucket, {
      key: 'k',
      limit: 2,
      windowMs: 60_000,
      nowMs: 1_000,
    });
    expect(second.result.allowed).toBe(true);
    const third = consumeFixedWindow(second.bucket, {
      key: 'k',
      limit: 2,
      windowMs: 60_000,
      nowMs: 1_000,
    });
    expect(third.result).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });
  });

  it('opens a new window after windowMs', () => {
    const first = consumeFixedWindow(undefined, { key: 'k', limit: 1, windowMs: 1_000, nowMs: 0 });
    const blocked = consumeFixedWindow(first.bucket, { key: 'k', limit: 1, windowMs: 1_000, nowMs: 999 });
    expect(blocked.result.allowed).toBe(false);
    const next = consumeFixedWindow(blocked.bucket, { key: 'k', limit: 1, windowMs: 1_000, nowMs: 1_000 });
    expect(next.result.allowed).toBe(true);
  });
});
