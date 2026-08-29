/**
 * Licensing labels for the dashboard UI.
 *
 * Mirrors packages/core `PROVIDER_LICENSING_LABELS` without importing `@meridian/core`.
 * PHASE 30: re-verify on one screen that sandbox and licensed_partner badges render distinctly
 * once a real licensed provider exists. Today only `unlicensed_sandbox` is live.
 */
export const PROVIDER_LICENSING_LABELS: Record<string, string> = {
  unlicensed_sandbox: 'Sandbox',
  licensed_partner: 'Licensed partner',
  internal_model: 'Internal model',
};

export const PROVIDER_LICENSING_HINTS: Record<string, string> = {
  unlicensed_sandbox: 'Unlicensed sandbox pricing. Indicative only; not a licensed institution.',
  licensed_partner: 'Licensed partner quote under a commercial agreement.',
  internal_model: 'Internal pricing model (benchmark or modelled curve), not a live licensed quote.',
};

export function providerLicensingLabel(licensing: string | undefined): string {
  if (licensing === undefined) {
    return PROVIDER_LICENSING_LABELS.unlicensed_sandbox ?? 'Sandbox';
  }
  return PROVIDER_LICENSING_LABELS[licensing] ?? 'Unknown source';
}

export function providerLicensingHint(licensing: string | undefined): string {
  if (licensing === undefined) {
    return PROVIDER_LICENSING_HINTS.unlicensed_sandbox ?? '';
  }
  return PROVIDER_LICENSING_HINTS[licensing] ?? 'Unknown licensing posture.';
}

export function isUnlicensedSandbox(licensing: string | undefined): boolean {
  return licensing === 'unlicensed_sandbox' || licensing === undefined;
}
