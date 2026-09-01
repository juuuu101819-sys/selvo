import {
  ALWAYS_OPEN_HOURS,
  type ExecutionPartner,
  type ExecutionPartnerCapabilities,
  type ProviderDescriptor,
} from '@meridian/core';
import { SandboxExecutionPartner } from './sandbox-execution-partner.js';

export const SANDBOX_PARTNER_BANK_FX_ID = 'sandbox-partner-bank-fx';
export const SANDBOX_PARTNER_PSP_FX_ID = 'sandbox-partner-psp-fx';
export const SANDBOX_PARTNER_STABLECOIN_VASP_ID = 'sandbox-partner-stablecoin-vasp';

const BANK_CAPABILITIES: ExecutionPartnerCapabilities = {
  partnerId: SANDBOX_PARTNER_BANK_FX_ID,
  kind: 'sandbox_mock',
  rail: 'bank_fx',
  quotedProviderId: 'sandbox-northgate-bank',
  corridors: [{ source: '*', destination: '*' }],
  currencies: ['*'],
  minAmountMinorUnits: '100000',
  maxAmountMinorUnits: '100000000000',
  maxAmountAsset: 'USD',
  operatingHours: ALWAYS_OPEN_HOURS,
  licenses: ['sandbox_mock_bank_fx'],
  sandbox: true,
  live: false,
};

const PSP_CAPABILITIES: ExecutionPartnerCapabilities = {
  partnerId: SANDBOX_PARTNER_PSP_FX_ID,
  kind: 'sandbox_mock',
  rail: 'payment_institution',
  quotedProviderId: 'sandbox-veridian-payments',
  corridors: [{ source: '*', destination: '*' }],
  currencies: ['*'],
  minAmountMinorUnits: '10000',
  maxAmountMinorUnits: '25000000000',
  maxAmountAsset: 'USD',
  operatingHours: ALWAYS_OPEN_HOURS,
  licenses: ['sandbox_mock_psp_fx'],
  sandbox: true,
  live: false,
};

const VASP_CAPABILITIES: ExecutionPartnerCapabilities = {
  partnerId: SANDBOX_PARTNER_STABLECOIN_VASP_ID,
  kind: 'sandbox_mock',
  rail: 'stablecoin_settlement',
  quotedProviderId: 'sandbox-solstice-settlement',
  corridors: [{ source: '*', destination: '*' }],
  currencies: ['*'],
  minAmountMinorUnits: '10000',
  maxAmountMinorUnits: '50000000000',
  maxAmountAsset: 'USD',
  operatingHours: ALWAYS_OPEN_HOURS,
  licenses: ['sandbox_mock_vasp'],
  sandbox: true,
  live: false,
};

function descriptor(
  capabilities: ExecutionPartnerCapabilities,
  name: string,
  description: string,
): ProviderDescriptor {
  return {
    id: capabilities.partnerId,
    name,
    rail: capabilities.rail,
    licensing: 'unlicensed_sandbox',
    modes: ['sandbox'],
    jurisdictions: ['*'],
    description,
    pricingVersion: 'sandbox-partner-1',
  };
}

/**
 * Sandbox-only mock execution partners. Live adapters are never constructed here, regardless of
 * `PARTNER_LIVE_ENABLED` — that flag only admits `kind: 'live'` into the registry, and this tree
 * has none.
 */
export function createSandboxExecutionPartners(): readonly ExecutionPartner[] {
  return [
    new SandboxExecutionPartner(
      descriptor(
        BANK_CAPABILITIES,
        'Northgate Bank (sandbox execution partner)',
        'Mock bank-FX partner. Settles to the beneficiary; Meridian only forwards a signed instruction.',
      ),
      BANK_CAPABILITIES,
      { extraDelayPolls: 1 },
    ),
    new SandboxExecutionPartner(
      descriptor(
        PSP_CAPABILITIES,
        'Veridian Payments (sandbox execution partner)',
        'Mock PSP-FX partner. Partial fills can be simulated via sandboxScenario=partial.',
      ),
      PSP_CAPABILITIES,
    ),
    new SandboxExecutionPartner(
      descriptor(
        VASP_CAPABILITIES,
        'Solstice Settlement (sandbox execution partner)',
        'Mock stablecoin-VASP partner. Webhook-driven status via sandboxScenario=webhook.',
      ),
      VASP_CAPABILITIES,
    ),
  ];
}
