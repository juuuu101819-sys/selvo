import { ValidationError } from '../errors/index.js';

export const LIST_LIMIT_MIN = 1;
export const LIST_LIMIT_MAX = 100;
export const LIST_LIMIT_DEFAULT = 20;
export const DASHBOARD_LIST_LIMIT_DEFAULT = 50;

const CURSOR_VERSION = 1;
const CURSOR_PREFIX = 'ks1.';

/**
 * Keyset identity for stable newest-first paging: `(sortAt DESC, id DESC)`.
 *
 * Offset paging drifts when rows are inserted between fetches. A seek on the last item of the
 * previous page does not.
 */
export interface ListCursor {
  readonly sortAt: string;
  readonly id: string;
}

export interface ListPageOptions {
  readonly limit: number;
  readonly after?: ListCursor | undefined;
}

/**
 * Opaque cursor. Callers must not parse it; an invalid or truncated value is a 400, not a skip.
 */
export function encodeListCursor(cursor: ListCursor): string {
  const payload = JSON.stringify({ v: CURSOR_VERSION, t: cursor.sortAt, i: cursor.id });
  return `${CURSOR_PREFIX}${Buffer.from(payload, 'utf8').toString('base64url')}`;
}

export function decodeListCursor(raw: string): ListCursor {
  if (!raw.startsWith(CURSOR_PREFIX)) {
    throw invalidCursor('unrecognised_cursor');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor('malformed_cursor');
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw invalidCursor('malformed_cursor');
  }
  const record = parsed as { readonly v?: unknown; readonly t?: unknown; readonly i?: unknown };
  if (record.v !== CURSOR_VERSION || typeof record.t !== 'string' || typeof record.i !== 'string') {
    throw invalidCursor('malformed_cursor');
  }
  if (record.t.trim() === '' || record.i.trim() === '') {
    throw invalidCursor('malformed_cursor');
  }
  return { sortAt: record.t, id: record.i };
}

export function isBeforeCursor(item: ListCursor, cursor: ListCursor): boolean {
  const time = item.sortAt.localeCompare(cursor.sortAt);
  if (time !== 0) {
    return time < 0;
  }
  return item.id.localeCompare(cursor.id) < 0;
}

export function compareKeysetDesc(left: ListCursor, right: ListCursor): number {
  const time = right.sortAt.localeCompare(left.sortAt);
  if (time !== 0) {
    return time;
  }
  return right.id.localeCompare(left.id);
}

export function takeKeysetPage<T>(
  items: readonly T[],
  options: ListPageOptions,
  keyOf: (item: T) => ListCursor,
): T[] {
  const ordered = [...items].sort((left, right) => compareKeysetDesc(keyOf(left), keyOf(right)));
  const filtered =
    options.after === undefined
      ? ordered
      : ordered.filter((item) => isBeforeCursor(keyOf(item), options.after as ListCursor));
  return filtered.slice(0, options.limit);
}

export function slicePage<T>(
  fetched: readonly T[],
  limit: number,
  keyOf: (item: T) => ListCursor,
): { readonly items: readonly T[]; readonly nextCursor: string | null } {
  const hasMore = fetched.length > limit;
  const items = hasMore ? fetched.slice(0, limit) : fetched;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last !== undefined ? encodeListCursor(keyOf(last)) : null,
  };
}

function invalidCursor(reason: string): ValidationError {
  return new ValidationError('Pagination cursor is invalid.', { reason });
}
