import { describe, expect, it } from 'vitest';
import {
  isUnlicensedSandbox,
  providerLicensingHint,
  providerLicensingLabel,
} from './licensing';

describe('provider licensing labels', () => {
  it('labels unlicensed_sandbox as Sandbox', () => {
    expect(providerLicensingLabel('unlicensed_sandbox')).toBe('Sandbox');
    expect(isUnlicensedSandbox('unlicensed_sandbox')).toBe(true);
    expect(providerLicensingHint('unlicensed_sandbox')).toMatch(/Unlicensed sandbox/i);
  });

  it('labels licensed_partner distinctly from sandbox', () => {
    expect(providerLicensingLabel('licensed_partner')).toBe('Licensed partner');
    expect(isUnlicensedSandbox('licensed_partner')).toBe(false);
    expect(providerLicensingLabel('licensed_partner')).not.toBe(
      providerLicensingLabel('unlicensed_sandbox'),
    );
  });

  it('treats a missing licensing field as sandbox (current catalog)', () => {
    expect(providerLicensingLabel(undefined)).toBe('Sandbox');
    expect(isUnlicensedSandbox(undefined)).toBe(true);
  });
});
