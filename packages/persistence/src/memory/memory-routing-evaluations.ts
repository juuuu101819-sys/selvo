import type {
  RoutingEvaluationRepository,
  StoredRoutingEvaluation,
} from '@meridian/core';

export class InMemoryRoutingEvaluationRepository implements RoutingEvaluationRepository {
  private readonly byId = new Map<string, StoredRoutingEvaluation>();

  save(evaluation: StoredRoutingEvaluation): Promise<void> {
    this.byId.set(evaluation.routingId, structuredClone(evaluation));
    return Promise.resolve();
  }

  findById(routingId: string): Promise<StoredRoutingEvaluation | null> {
    const found = this.byId.get(routingId);
    return Promise.resolve(found === undefined ? null : structuredClone(found));
  }
}
