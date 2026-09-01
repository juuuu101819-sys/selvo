import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import { evaluateSandboxCompliance } from './execution-compliance.js';

describe('evaluateSandboxCompliance', () => {
  it('passes when the caller omits an outcome', () => {
    expect(evaluateSandboxCompliance(undefined)).toBe('pass');
  });

  it('parks review and denies an explicit deny', () => {
    expect(evaluateSandboxCompliance('review')).toBe('review');
    expect(evaluateSandboxCompliance('deny')).toBe('deny');
  });

  it('fail-closes an unknown outcome', () => {
    expect(() => evaluateSandboxCompliance('approve_anyway')).toThrow(ValidationError);
  });
});
