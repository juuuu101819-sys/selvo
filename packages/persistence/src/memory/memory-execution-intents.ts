import type { ExecutionIntent, ExecutionIntentRepository } from '@meridian/core';

const DEFAULT_LIST_LIMIT = 50;

/**
 * In-process execution intents.
 *
 * An intent is a recorded route choice. Status is always `recorded`; `executable` and `submitted`
 * are always false. Nothing here can become a payment.
 */
export class InMemoryExecutionIntentRepository implements ExecutionIntentRepository {
  private readonly byId = new Map<string, ExecutionIntent>();

  create(intent: ExecutionIntent): Promise<ExecutionIntent> {
    const stored: ExecutionIntent = {
      ...intent,
      status: 'recorded',
      executable: false,
      submitted: false,
    };
    this.byId.set(stored.id, structuredClone(stored));
    return Promise.resolve(structuredClone(stored));
  }

  findById(id: string, organizationId: string): Promise<ExecutionIntent | null> {
    const found = this.byId.get(id);
    if (found === undefined || found.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(found));
  }

  listByOrganization(
    organizationId: string,
    options: { readonly limit?: number } = {},
  ): Promise<readonly ExecutionIntent[]> {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    const ordered = [...this.byId.values()]
      .filter((intent) => intent.organizationId === organizationId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((intent) => structuredClone(intent));
    return Promise.resolve(ordered);
  }
}
