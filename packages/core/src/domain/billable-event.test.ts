import { describe, expect, it } from 'vitest';
import {
  BILLABLE_ACTIONS,
  BILLABLE_CLASS_FOR_ACTION,
  BILLABLE_EVENT_CLASSES,
  assertNoDoubleCharge,
  billableClassForAction,
  isMeteredAction,
} from './billable-event.js';
import { meteredEndpointForAction } from './usage-metering.js';

describe('§18.6 billable-event taxonomy does not overlap', () => {
  it('maps every action to exactly one charge class', () => {
    for (const action of BILLABLE_ACTIONS) {
      const classes = BILLABLE_EVENT_CLASSES.filter(
        (eventClass) => BILLABLE_CLASS_FOR_ACTION[action] === eventClass,
      );
      expect(classes).toHaveLength(1);
    }
  });

  it('bills an execution-intent decision as FLAT_DECISION and never meters it too', () => {
    // The specific double charge this taxonomy exists to prevent: generating an execution intent
    // is also an API call, so without the rule it would be billed as both.
    expect(billableClassForAction('decision.execution_intent')).toBe('FLAT_DECISION');
    expect(isMeteredAction('decision.execution_intent')).toBe(false);
    expect(meteredEndpointForAction('decision.execution_intent')).toBeNull();
  });

  it('meters read actions and gives each one its own endpoint counter', () => {
    const metered = BILLABLE_ACTIONS.filter(isMeteredAction);
    const endpoints = metered.map((action) => meteredEndpointForAction(action));
    expect(endpoints.every((endpoint) => endpoint !== null)).toBe(true);
    expect(new Set(endpoints).size).toBe(metered.length);
  });

  it('accepts a charge set where each action appears under its own class', () => {
    expect(() =>
      assertNoDoubleCharge([
        { action: 'subscription.period', eventClass: 'SUBSCRIPTION_PERIOD' },
        { action: 'quote.read', eventClass: 'METERED_CALL' },
        { action: 'decision.execution_intent', eventClass: 'FLAT_DECISION' },
      ]),
    ).not.toThrow();
  });

  it('refuses a decision billed as a metered call as well', () => {
    expect(() =>
      assertNoDoubleCharge([
        { action: 'decision.execution_intent', eventClass: 'FLAT_DECISION' },
        { action: 'decision.execution_intent', eventClass: 'METERED_CALL' },
      ]),
    ).toThrow(/must not be charged as METERED_CALL/);
  });

  it('refuses a read action billed as a per-decision fee', () => {
    expect(() =>
      assertNoDoubleCharge([{ action: 'quote.read', eventClass: 'FLAT_DECISION' }]),
    ).toThrow(/billed as METERED_CALL/);
  });
});
