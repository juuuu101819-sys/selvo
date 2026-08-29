import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import {
  compareKeysetDesc,
  decodeListCursor,
  encodeListCursor,
  isBeforeCursor,
  slicePage,
  takeKeysetPage,
} from './cursor.js';

describe('list cursor', () => {
  it('round-trips a keyset', () => {
    const cursor = { sortAt: '2026-08-29T00:00:00.000Z', id: 'cmp_aaa' };
    expect(decodeListCursor(encodeListCursor(cursor))).toEqual(cursor);
  });

  it('rejects garbage, truncated, and unversioned values', () => {
    expect(() => decodeListCursor('not-a-cursor')).toThrow(ValidationError);
    expect(() => decodeListCursor('ks1.')).toThrow(ValidationError);
    expect(() => decodeListCursor('ks1.%%%')).toThrow(ValidationError);
    expect(() => decodeListCursor(Buffer.from('{"v":1}', 'utf8').toString('base64url'))).toThrow(
      ValidationError,
    );
  });

  it('orders newest first and seeks past the cursor without duplicating it', () => {
    const rows = [
      { id: 'a', sortAt: '2026-01-01T00:00:00.000Z' },
      { id: 'c', sortAt: '2026-01-03T00:00:00.000Z' },
      { id: 'b', sortAt: '2026-01-02T00:00:00.000Z' },
      { id: 'd', sortAt: '2026-01-03T00:00:00.000Z' },
    ];
    const keyOf = (row: (typeof rows)[number]) => ({ sortAt: row.sortAt, id: row.id });
    const first = takeKeysetPage(rows, { limit: 2 }, keyOf);
    expect(first.map((row) => row.id)).toEqual(['d', 'c']);
    const second = takeKeysetPage(rows, { limit: 2, after: keyOf(first[1]!) }, keyOf);
    expect(second.map((row) => row.id)).toEqual(['b', 'a']);
    expect(first.some((row) => second.some((other) => other.id === row.id))).toBe(false);
  });

  it('does not include a row inserted after page 1 in page 2', () => {
    const original = [
      { id: 'old-2', sortAt: '2026-01-02T00:00:00.000Z' },
      { id: 'old-1', sortAt: '2026-01-01T00:00:00.000Z' },
      { id: 'old-3', sortAt: '2026-01-03T00:00:00.000Z' },
    ];
    const keyOf = (row: (typeof original)[number]) => ({ sortAt: row.sortAt, id: row.id });
    const page1 = takeKeysetPage(original, { limit: 2 }, keyOf);
    expect(page1.map((row) => row.id)).toEqual(['old-3', 'old-2']);
    const withInsert = [...original, { id: 'new', sortAt: '2026-01-04T00:00:00.000Z' }];
    const page2 = takeKeysetPage(withInsert, { limit: 2, after: keyOf(page1[1]!) }, keyOf);
    expect(page2.map((row) => row.id)).toEqual(['old-1']);
    expect(page2.map((row) => row.id)).not.toContain('new');
    expect(page2.map((row) => row.id)).not.toContain('old-3');
  });

  it('slicePage emits nextCursor only when more rows remain', () => {
    const rows = [
      { id: 'b', sortAt: '2026-01-02T00:00:00.000Z' },
      { id: 'a', sortAt: '2026-01-01T00:00:00.000Z' },
      { id: 'c', sortAt: '2026-01-03T00:00:00.000Z' },
    ];
    const keyOf = (row: (typeof rows)[number]) => ({ sortAt: row.sortAt, id: row.id });
    const fetched = takeKeysetPage(rows, { limit: 3 }, keyOf);
    const page = slicePage(fetched, 2, keyOf);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const last = slicePage(takeKeysetPage(rows, { limit: 10 }, keyOf), 10, keyOf);
    expect(last.nextCursor).toBeNull();
  });

  it('isBeforeCursor matches DESC lexicographic order', () => {
    const newer = { sortAt: '2026-01-02T00:00:00.000Z', id: 'z' };
    const older = { sortAt: '2026-01-01T00:00:00.000Z', id: 'a' };
    expect(isBeforeCursor(older, newer)).toBe(true);
    expect(isBeforeCursor(newer, older)).toBe(false);
    expect(compareKeysetDesc(newer, older)).toBeLessThan(0);
  });
});
