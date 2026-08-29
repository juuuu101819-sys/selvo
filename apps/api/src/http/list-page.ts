import {
  ValidationError,
  decodeListCursor,
  slicePage,
  type ListCursor,
} from '@meridian/core';

export async function resolveListCursor<T>(
  raw: string | undefined,
  lookup: (id: string) => Promise<T | null>,
  keyOf: (item: T) => ListCursor,
): Promise<ListCursor | undefined> {
  if (raw === undefined) {
    return undefined;
  }
  const decoded = decodeListCursor(raw);
  const found = await lookup(decoded.id);
  if (found === null) {
    throw new ValidationError('Pagination cursor is invalid.', { reason: 'unknown_or_foreign_cursor' });
  }
  const key = keyOf(found);
  if (key.sortAt !== decoded.sortAt || key.id !== decoded.id) {
    throw new ValidationError('Pagination cursor is invalid.', { reason: 'tampered_cursor' });
  }
  return key;
}

export { slicePage };
