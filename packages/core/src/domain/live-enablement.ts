import { ValidationError } from '../errors/index.js';

/**
 * Live funds movement and live billing are fail-closed.
 *
 * Operator flags (`PARTNER_LIVE_ENABLED`, `BILLING_LIVE_ENABLED`) default to false. Per-corridor
 * and per-partner rows stay sandbox unless a complete legal/licensing sign-off is recorded.
 * Missing metadata never enables live. See `GO_LIVE_CHECKLIST.md`.
 */

/** Repo-root checklist every live flag comments must link. */
export const GO_LIVE_CHECKLIST_PATH = 'GO_LIVE_CHECKLIST.md';

export const LIVE_ENABLEMENT_SCOPES = ['corridor', 'partner', 'billing'] as const;
export type LiveEnablementScope = (typeof LIVE_ENABLEMENT_SCOPES)[number];

/**
 * The only corridors that may be live-enabled. Each has a matching section in
 * {@link GO_LIVE_CHECKLIST_PATH}. A corridor without a checklist section cannot be turned live.
 */
export const GO_LIVE_CHECKLIST_CORRIDORS = [
  'USD|KRW',
  'KRW|USD',
  'USD|EUR',
  'EUR|USD',
  'EUR|KRW',
  'KRW|EUR',
  'USD|JPY',
  'JPY|USD',
  'USD|GBP',
  'GBP|USD',
] as const;

export type GoLiveCorridor = (typeof GO_LIVE_CHECKLIST_CORRIDORS)[number];

export const BILLING_LIVE_SCOPE_KEY = 'platform' as const;

/**
 * ISO 4217 asset → licensing region used by the region kill switch.
 * EUR maps to `EU` (not a single member state).
 */
export const ASSET_LICENSING_REGION: Readonly<Record<string, string>> = {
  AED: 'AE',
  AUD: 'AU',
  BRL: 'BR',
  CAD: 'CA',
  CHF: 'CH',
  CLP: 'CL',
  CNY: 'CN',
  EUR: 'EU',
  GBP: 'GB',
  HKD: 'HK',
  IDR: 'ID',
  INR: 'IN',
  JPY: 'JP',
  KES: 'KE',
  KRW: 'KR',
  KWD: 'KW',
  MXN: 'MX',
  NGN: 'NG',
  PHP: 'PH',
  SGD: 'SG',
  THB: 'TH',
  TRY: 'TR',
  USD: 'US',
  VND: 'VN',
  ZAR: 'ZA',
};

export const GO_LIVE_REGIONS = [
  ...new Set(Object.values(ASSET_LICENSING_REGION)),
].sort() as readonly string[];

export interface LegalSignOff {
  /** Human or service account that recorded the approval. */
  readonly approvedBy: string;
  /** Named licence / opinion that authorises this scope (never an empty placeholder). */
  readonly licenseBasis: string;
  /** When counsel/compliance approved. ISO-8601 UTC. */
  readonly approvedAt: string;
  /** Licence or opinion expiry. Evaluation fail-closes at or after this instant. */
  readonly expiresAt: string;
  /** Must match the machine-required checklist anchor for this scope. */
  readonly checklistRef: string;
}

export interface LiveEnablementRecord {
  readonly id: string;
  readonly scope: LiveEnablementScope;
  readonly scopeKey: string;
  readonly region: string;
  readonly enabled: boolean;
  readonly signOff: LegalSignOff;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly disabledAt: string | null;
  readonly disabledReason: string | null;
}

export interface SignOffEvaluation {
  readonly valid: boolean;
  readonly current: boolean;
  readonly reason: string | null;
}

export interface LiveFundsEvaluation {
  /** Always false in this repository: no live settlement adapter exists. */
  readonly liveFundsMovementActive: boolean;
  readonly sandbox: true;
  readonly fundsMoved: false;
  readonly partnerLiveEnabled: boolean;
  readonly corridorSignedOffAndCurrent: boolean;
  readonly partnerSignedOffAndCurrent: boolean;
  readonly regionOpen: boolean;
  readonly adaptersImplemented: false;
  readonly blockingReasons: readonly string[];
}

export interface LiveBillingEvaluation {
  /** Always false: no processor adapter writes `collected`. */
  readonly collectionActive: boolean;
  readonly collected: false;
  readonly fundsMoved: false;
  readonly realizedRevenue: false;
  readonly billingLiveEnabled: boolean;
  readonly billingSignedOffAndCurrent: boolean;
  readonly legalEntityConfirmed: false;
  readonly adapterImplemented: false;
  readonly blockingReasons: readonly string[];
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function isLiveEnablementScope(value: unknown): value is LiveEnablementScope {
  return typeof value === 'string' && (LIVE_ENABLEMENT_SCOPES as readonly string[]).includes(value);
}

export function isGoLiveCorridor(value: unknown): value is GoLiveCorridor {
  return typeof value === 'string' && (GO_LIVE_CHECKLIST_CORRIDORS as readonly string[]).includes(value);
}

export function corridorSlug(corridor: string): string {
  return corridor.trim().toUpperCase().replace('|', '-').toLowerCase();
}

/**
 * Required `GO_LIVE_CHECKLIST.md` anchor for this scope.
 * A mismatch is a refused live conversion — not a warning.
 */
export function requiredChecklistRef(scope: LiveEnablementScope, scopeKey: string): string {
  if (scope === 'corridor') {
    return `${GO_LIVE_CHECKLIST_PATH}#${corridorSlug(scopeKey)}`;
  }
  if (scope === 'partner') {
    return `${GO_LIVE_CHECKLIST_PATH}#partners`;
  }
  return `${GO_LIVE_CHECKLIST_PATH}#billing-collection`;
}

export function parseCorridorKey(corridor: string): { readonly source: string; readonly destination: string } {
  const parts = corridor.trim().toUpperCase().split('|');
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined || parts[0] === '' || parts[1] === '') {
    throw new ValidationError('Corridor must be SOURCE|DESTINATION (for example USD|KRW).', { corridor });
  }
  return { source: parts[0], destination: parts[1] };
}

export function formatCorridorKey(source: string, destination: string): string {
  return `${source.trim().toUpperCase()}|${destination.trim().toUpperCase()}`;
}

export function regionOfAsset(asset: string): string | null {
  const code = asset.trim().toUpperCase();
  return ASSET_LICENSING_REGION[code] ?? null;
}

export function regionsForCorridor(sourceAsset: string, destinationAsset: string): readonly string[] {
  const regions = new Set<string>();
  const source = regionOfAsset(sourceAsset);
  const destination = regionOfAsset(destinationAsset);
  if (source !== null) {
    regions.add(source);
  }
  if (destination !== null) {
    regions.add(destination);
  }
  return [...regions].sort();
}

export function regionsForCorridorKey(corridor: string): readonly string[] {
  const { source, destination } = parseCorridorKey(corridor);
  return regionsForCorridor(source, destination);
}

export function isKnownGoLiveRegion(region: string): boolean {
  return GO_LIVE_REGIONS.includes(region.trim().toUpperCase());
}

function parseIsoInstant(value: string, field: string): number {
  if (!ISO_INSTANT.test(value)) {
    throw new ValidationError(`${field} must be an ISO-8601 UTC instant.`, { field, value });
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new ValidationError(`${field} must be an ISO-8601 UTC instant.`, { field, value });
  }
  return ms;
}

function requireNonEmpty(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`Legal sign-off field "${field}" is required. Live conversion is refused.`, {
      field,
    });
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ValidationError(`Legal sign-off field "${field}" exceeds ${max} characters.`, { field });
  }
  return trimmed;
}

/**
 * Fail-closed parser. Any missing or placeholder field refuses live conversion.
 */
export function parseLegalSignOff(
  raw: unknown,
  input: { readonly scope: LiveEnablementScope; readonly scopeKey: string; readonly nowIso: string },
): LegalSignOff {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError(
      'Legal/licensing sign-off metadata is required before live enablement. Sandbox is retained.',
      { scope: input.scope, scopeKey: input.scopeKey },
    );
  }
  const body = raw as Record<string, unknown>;
  const approvedBy = requireNonEmpty(body['approvedBy'], 'approvedBy', 256);
  const licenseBasis = requireNonEmpty(body['licenseBasis'], 'licenseBasis', 2000);
  const approvedAtRaw = requireNonEmpty(body['approvedAt'], 'approvedAt', 40);
  const expiresAtRaw = requireNonEmpty(body['expiresAt'], 'expiresAt', 40);
  const checklistRef = requireNonEmpty(body['checklistRef'], 'checklistRef', 256);

  const expectedRef = requiredChecklistRef(input.scope, input.scopeKey);
  if (checklistRef !== expectedRef) {
    throw new ValidationError(
      `checklistRef must be "${expectedRef}" for this scope. Corridors without a checklist section cannot go live.`,
      { checklistRef, expectedRef, scope: input.scope, scopeKey: input.scopeKey },
    );
  }

  const approvedMs = parseIsoInstant(approvedAtRaw, 'approvedAt');
  const expiresMs = parseIsoInstant(expiresAtRaw, 'expiresAt');
  const nowMs = parseIsoInstant(input.nowIso, 'nowIso');
  if (expiresMs <= approvedMs) {
    throw new ValidationError('Sign-off expiresAt must be after approvedAt.', {
      approvedAt: approvedAtRaw,
      expiresAt: expiresAtRaw,
    });
  }
  if (expiresMs <= nowMs) {
    throw new ValidationError(
      'Sign-off expiresAt is not in the future. Expired licence metadata cannot enable live.',
      { expiresAt: expiresAtRaw, nowIso: input.nowIso },
    );
  }

  return {
    approvedBy,
    licenseBasis,
    approvedAt: new Date(approvedMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    checklistRef,
  };
}

export function evaluateSignOff(signOff: LegalSignOff | null | undefined, nowIso: string): SignOffEvaluation {
  if (signOff === null || signOff === undefined) {
    return { valid: false, current: false, reason: 'signoff_missing' };
  }
  if (
    signOff.approvedBy.trim() === '' ||
    signOff.licenseBasis.trim() === '' ||
    signOff.approvedAt.trim() === '' ||
    signOff.expiresAt.trim() === '' ||
    signOff.checklistRef.trim() === ''
  ) {
    return { valid: false, current: false, reason: 'signoff_incomplete' };
  }
  const expiresMs = Date.parse(signOff.expiresAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(expiresMs) || !Number.isFinite(nowMs) || expiresMs <= nowMs) {
    return { valid: true, current: false, reason: 'license_expired' };
  }
  return { valid: true, current: true, reason: null };
}

export function evaluateEnablementRecord(
  record: LiveEnablementRecord | null | undefined,
  nowIso: string,
): SignOffEvaluation {
  if (record === null || record === undefined || !record.enabled) {
    return { valid: false, current: false, reason: 'not_enabled' };
  }
  return evaluateSignOff(record.signOff, nowIso);
}

/**
 * Live funds movement admission. Never returns `liveFundsMovementActive: true` in this tree:
 * there is no live settlement adapter (`GO_LIVE_CHECKLIST.md`, `PARTNER_LIVE_ENABLED`).
 */
export function evaluateLiveFundsMovement(input: {
  readonly nowIso: string;
  readonly partnerLiveEnabled: boolean;
  readonly corridor: string;
  readonly partnerId: string | null;
  readonly corridorRecord: LiveEnablementRecord | null;
  readonly partnerRecord: LiveEnablementRecord | null;
  readonly engagedRegions: readonly string[];
}): LiveFundsEvaluation {
  const blockingReasons: string[] = [];
  // GO_LIVE_CHECKLIST.md — process flag. Default false; code never turns this on.
  if (!input.partnerLiveEnabled) {
    blockingReasons.push('PARTNER_LIVE_ENABLED=false');
  }

  const corridorState = evaluateEnablementRecord(input.corridorRecord, input.nowIso);
  const corridorSignedOffAndCurrent = corridorState.current;
  if (!corridorSignedOffAndCurrent) {
    blockingReasons.push(`corridor:${corridorState.reason ?? 'not_enabled'}`);
  }

  let partnerSignedOffAndCurrent = false;
  if (input.partnerId === null || input.partnerId.trim() === '') {
    blockingReasons.push('partner_not_specified');
  } else {
    const partnerState = evaluateEnablementRecord(input.partnerRecord, input.nowIso);
    partnerSignedOffAndCurrent = partnerState.current;
    if (!partnerSignedOffAndCurrent) {
      blockingReasons.push(`partner:${partnerState.reason ?? 'not_enabled'}`);
    }
  }

  const corridorRegions = regionsForCorridorKey(input.corridor);
  const engaged = new Set(input.engagedRegions.map((region) => region.trim().toUpperCase()));
  const killed = corridorRegions.filter((region) => engaged.has(region));
  const regionOpen = killed.length === 0;
  if (!regionOpen) {
    blockingReasons.push(`region_kill_switch:${killed.join(',')}`);
  }

  // GO_LIVE_CHECKLIST.md#partners — no live adapter is registered in this repository.
  blockingReasons.push('live_adapters_not_implemented');

  return {
    liveFundsMovementActive: false,
    sandbox: true,
    fundsMoved: false,
    partnerLiveEnabled: input.partnerLiveEnabled,
    corridorSignedOffAndCurrent,
    partnerSignedOffAndCurrent,
    regionOpen,
    adaptersImplemented: false,
    blockingReasons,
  };
}

/**
 * Live billing collection admission.
 *
 * `BILLING_LIVE_ENABLED` defaults false (invoice recording only). Even when the flag is true,
 * collection stays refused without current billing sign-off, a confirmed legal entity, and a
 * real processor adapter — none of which this repository invents.
 * See `GO_LIVE_CHECKLIST.md#billing-collection`.
 */
export function evaluateLiveBilling(input: {
  readonly nowIso: string;
  readonly billingLiveEnabled: boolean;
  readonly billingRecord: LiveEnablementRecord | null;
}): LiveBillingEvaluation {
  const blockingReasons: string[] = [];
  if (!input.billingLiveEnabled) {
    blockingReasons.push('BILLING_LIVE_ENABLED=false');
  }
  const signOff = evaluateEnablementRecord(input.billingRecord, input.nowIso);
  if (!signOff.current) {
    blockingReasons.push(`billing:${signOff.reason ?? 'not_enabled'}`);
  }
  blockingReasons.push('legal_entity_unconfirmed');
  blockingReasons.push('collection_adapter_not_implemented');

  return {
    collectionActive: false,
    collected: false,
    fundsMoved: false,
    realizedRevenue: false,
    billingLiveEnabled: input.billingLiveEnabled,
    billingSignedOffAndCurrent: signOff.current,
    legalEntityConfirmed: false,
    adapterImplemented: false,
    blockingReasons,
  };
}

export function assertCorridorMayGoLive(corridor: string): GoLiveCorridor {
  const key = corridor.trim().toUpperCase();
  if (!isGoLiveCorridor(key)) {
    throw new ValidationError(
      `Corridor "${key}" has no GO_LIVE_CHECKLIST.md section and cannot be live-enabled.`,
      { corridor: key, allowed: [...GO_LIVE_CHECKLIST_CORRIDORS] },
    );
  }
  return key;
}

export function assertRegionAllowedForScope(
  scope: LiveEnablementScope,
  scopeKey: string,
  region: string,
): string {
  const normalized = region.trim().toUpperCase();
  if (!isKnownGoLiveRegion(normalized)) {
    throw new ValidationError(`Unknown licensing region "${region}".`, { region, allowed: [...GO_LIVE_REGIONS] });
  }
  if (scope === 'corridor') {
    const touched = regionsForCorridorKey(scopeKey);
    if (!touched.includes(normalized)) {
      throw new ValidationError(
        `Region "${normalized}" is not a licensing region for corridor ${scopeKey}.`,
        { region: normalized, corridor: scopeKey, touched },
      );
    }
  }
  return normalized;
}
