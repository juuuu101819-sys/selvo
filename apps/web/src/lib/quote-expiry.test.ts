import { describe, expect, it } from 'vitest';
import {
  EXPIRING_THRESHOLD_MS,
  classifyQuoteExpiry,
  earliestExpiry,
  formatRemaining,
} from './quote-expiry';

const NOW = Date.parse('2026-03-01T12:00:00.000Z');

describe('classifyQuoteExpiry', () => {
  it('reports a quote with comfortable life left as live', () => {
    expect(classifyQuoteExpiry('2026-03-01T12:15:00.000Z', NOW)).toEqual({
      state: 'live',
      remainingMs: 900_000,
    });
  });

  it('warns before the price disappears, not at the moment it does', () => {
    expect(classifyQuoteExpiry('2026-03-01T12:00:15.000Z', NOW)).toEqual({
      state: 'expiring',
      remainingMs: 15_000,
    });
  });

  it('does not warn while most of a short TTL still remains', () => {
    // A 60-second rail quote at 45s remaining is healthy, not about to vanish.
    expect(classifyQuoteExpiry('2026-03-01T12:00:45.000Z', NOW).state).toBe('live');
  });

  it('treats the threshold boundary as expiring', () => {
    const atThreshold = new Date(NOW + EXPIRING_THRESHOLD_MS).toISOString();
    expect(classifyQuoteExpiry(atThreshold, NOW).state).toBe('expiring');
  });

  it('reports an expired quote with how long ago it died', () => {
    expect(classifyQuoteExpiry('2026-03-01T11:59:30.000Z', NOW)).toEqual({
      state: 'expired',
      expiredForMs: 30_000,
    });
  });

  it('treats the expiry instant itself as expired', () => {
    expect(classifyQuoteExpiry('2026-03-01T12:00:00.000Z', NOW).state).toBe('expired');
  });

  it('handles a quote that states no expiry', () => {
    expect(classifyQuoteExpiry(null, NOW)).toEqual({ state: 'no_expiry' });
  });

  it('fails toward expired on an unreadable timestamp, never toward live', () => {
    expect(classifyQuoteExpiry('soon', NOW).state).toBe('expired');
  });
});

describe('earliestExpiry', () => {
  it('finds the shortest-lived quote, which bounds the whole comparison', () => {
    expect(
      earliestExpiry([
        '2026-03-01T12:15:00.000Z',
        '2026-03-01T12:01:00.000Z',
        '2026-03-01T12:10:00.000Z',
      ]),
    ).toBe('2026-03-01T12:01:00.000Z');
  });

  it('ignores quotes without an expiry rather than treating them as immediate', () => {
    expect(earliestExpiry([null, '2026-03-01T12:05:00.000Z'])).toBe('2026-03-01T12:05:00.000Z');
  });

  it('returns null when nothing expires', () => {
    expect(earliestExpiry([null, null])).toBeNull();
    expect(earliestExpiry([])).toBeNull();
  });

  it('skips unreadable timestamps', () => {
    expect(earliestExpiry(['garbage', '2026-03-01T12:05:00.000Z'])).toBe(
      '2026-03-01T12:05:00.000Z',
    );
  });
});

describe('formatRemaining', () => {
  it('reads like a countdown', () => {
    expect(formatRemaining(247_000)).toBe('4:07');
    expect(formatRemaining(32_000)).toBe('0:32');
    expect(formatRemaining(0)).toBe('0:00');
  });

  it('never renders a negative countdown', () => {
    expect(formatRemaining(-5_000)).toBe('0:00');
  });

  it('switches to hours for long-lived quotes', () => {
    expect(formatRemaining(4_320_000)).toBe('1h 12m');
  });
});
