import { describe, expect, it } from 'vitest';
import { FixedClock, SequentialIdGenerator, noopLogger, type AuditEvent, type AuditEventInput, type AuditLogger } from '../ports/index.js';
import { buildDemoFinancialGraph } from './demo-graph.js';
import { RouteGraphService } from './service.js';

class RecordingAuditLogger implements AuditLogger {
  readonly events: AuditEvent[] = [];
  private sequence = 0;

  record(input: AuditEventInput): Promise<AuditEvent> {
    this.sequence += 1;
    const event: AuditEvent = {
      ...input,
      eventId: `evt_${this.sequence}`,
      occurredAt: '2026-01-01T00:00:00.000Z',
    };
    this.events.push(event);
    return Promise.resolve(event);
  }
}

describe('RouteGraphService', () => {
  it('records graph search audit events and never marks paths executable', async () => {
    const audit = new RecordingAuditLogger();
    const service = new RouteGraphService({
      mode: 'sandbox',
      graph: buildDemoFinancialGraph(),
      clock: new FixedClock('2026-04-01T12:00:00.000Z'),
      ids: new SequentialIdGenerator(),
      auditLogger: audit,
      logger: noopLogger,
    });

    const search = await service.discover({
      organizationId: 'org_demo',
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      maxHops: 3,
      actor: 'test',
      requestId: 'req_1',
    });

    expect(search.searchId).toBe('gph_00000001');
    expect(search.discovery.paths.length).toBeGreaterThan(0);
    expect(search.discovery.executable).toBe(false);
    expect(search.discovery.aiUsed).toBe(false);
    expect(search.discovery.recommendedPath?.executable).toBe(false);
    expect(audit.events.map((event) => event.type)).toEqual([
      'routing.graph.requested',
      'routing.graph.completed',
    ]);
  });
});
