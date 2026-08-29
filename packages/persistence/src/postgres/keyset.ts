import type { ListCursor } from '@meridian/core';

/** Prisma `where` fragment for newest-first keyset: (time, id) < cursor. */
export function descKeysetWhere(
  after: ListCursor | undefined,
  timeField: string,
  idField: string,
): Record<string, unknown> {
  if (after === undefined) {
    return {};
  }
  const sortAt = new Date(after.sortAt);
  return {
    OR: [
      { [timeField]: { lt: sortAt } },
      { AND: [{ [timeField]: sortAt }, { [idField]: { lt: after.id } }] },
    ],
  };
}
