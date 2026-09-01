import { createHash } from 'node:crypto';
import { toAssetMinorUnits } from '../domain/asset.js';
import { ValidationError } from '../errors/index.js';
import { canonicalJson } from '../reproducibility/canonical-json.js';
import type { JsonObject } from '../domain/json.js';
import type { ScoredMultiRailRoute, MultiRailRouting } from '../engine/routing-types.js';
import {
  corridorKey,
  type MandateCorridor,
  type MandateScope,
} from './types.js';

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function omitProof<T extends Record<string, unknown>>(document: T): Omit<T, 'proof'> {
  const { proof: _proof, ...rest } = document;
  return rest;
}

export function parseScopeFromSubject(subject: unknown): MandateScope {
  if (subject === null || typeof subject !== 'object') {
    throw new ValidationError('Mandate credentialSubject must be an object.', { failClosed: true });
  }
  const record = subject as Record<string, unknown>;
  const spendCap = record['spendCap'];
  if (spendCap === null || typeof spendCap !== 'object') {
    throw new ValidationError('Mandate spendCap is required.', { failClosed: true });
  }
  const cap = spendCap as Record<string, unknown>;
  if (typeof cap['amount'] !== 'string' || typeof cap['currency'] !== 'string') {
    throw new ValidationError('Mandate spendCap requires amount and currency strings.', {
      failClosed: true,
    });
  }
  const spendCapAsset = cap['currency'].trim().toUpperCase();
  const spendCapMinorUnits = toAssetMinorUnits(spendCapAsset, cap['amount']);
  if (BigInt(spendCapMinorUnits) <= 0n) {
    throw new ValidationError('Mandate spendCap must be greater than zero.', { failClosed: true });
  }

  const corridors = parseCorridors(record['allowedCorridors']);
  const currencies = parseTokenList(record['allowedCurrencies'], 'asset');
  const beneficiaries = parseTokenList(record['allowedBeneficiaries'], 'beneficiary');
  if (corridors.length === 0 || currencies.length === 0 || beneficiaries.length === 0) {
    throw new ValidationError(
      'Mandate scope is fail-closed: allowedCorridors, allowedCurrencies, and allowedBeneficiaries must each list at least one value.',
      { failClosed: true },
    );
  }
  return {
    spendCapMinorUnits,
    spendCapAsset,
    allowedCorridors: corridors,
    allowedCurrencies: currencies,
    allowedBeneficiaries: beneficiaries,
  };
}

function parseCorridors(value: unknown): readonly MandateCorridor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const corridors: MandateCorridor[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const row = entry as Record<string, unknown>;
    if (typeof row['source'] !== 'string' || typeof row['destination'] !== 'string') {
      continue;
    }
    const source = row['source'].trim().toUpperCase();
    const destination = row['destination'].trim().toUpperCase();
    if (source.length === 0 || destination.length === 0 || source === destination) {
      continue;
    }
    corridors.push({ source, destination });
  }
  return corridors;
}

function parseTokenList(value: unknown, kind: 'asset' | 'beneficiary'): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const token = entry.trim();
    if (token.length === 0 || token.length > 80) {
      continue;
    }
    const stored = kind === 'asset' ? token.toUpperCase() : token.toLowerCase();
    if (!unique.includes(stored)) {
      unique.push(stored);
    }
  }
  return unique;
}

export function intersectScopes(scopes: readonly MandateScope[]): MandateScope {
  if (scopes.length === 0) {
    throw new ValidationError('Cannot intersect an empty mandate set.', { failClosed: true });
  }
  const first = scopes[0];
  if (first === undefined) {
    throw new ValidationError('Cannot intersect an empty mandate set.', { failClosed: true });
  }
  let spendCapMinorUnits = BigInt(first.spendCapMinorUnits);
  const spendCapAsset = first.spendCapAsset;
  let corridors = new Set(first.allowedCorridors.map(corridorKey));
  let currencies = new Set(first.allowedCurrencies);
  let beneficiaries = new Set(first.allowedBeneficiaries);
  for (const scope of scopes.slice(1)) {
    if (scope.spendCapAsset !== spendCapAsset) {
      throw new ValidationError('Active mandates lock different spend-cap assets; fail closed.', {
        failClosed: true,
        assets: [spendCapAsset, scope.spendCapAsset],
      });
    }
    const cap = BigInt(scope.spendCapMinorUnits);
    if (cap < spendCapMinorUnits) {
      spendCapMinorUnits = cap;
    }
    corridors = new Set([...corridors].filter((key) => scope.allowedCorridors.some((c) => corridorKey(c) === key)));
    currencies = new Set([...currencies].filter((asset) => scope.allowedCurrencies.includes(asset)));
    beneficiaries = new Set(
      [...beneficiaries].filter((code) => scope.allowedBeneficiaries.includes(code)),
    );
  }
  return {
    spendCapMinorUnits: spendCapMinorUnits.toString(),
    spendCapAsset,
    allowedCorridors: [...corridors].map((key) => {
      const [source, destination] = key.split(':');
      return { source: source ?? '', destination: destination ?? '' };
    }),
    allowedCurrencies: [...currencies],
    allowedBeneficiaries: [...beneficiaries],
  };
}

export function mandateAllowsCorridor(
  scope: MandateScope,
  sourceAsset: string,
  destinationAsset: string,
): boolean {
  const source = sourceAsset.toUpperCase();
  const dest = destinationAsset.toUpperCase();
  if (scope.allowedCorridors.length === 0) {
    return false;
  }
  if (!scope.allowedCorridors.some((c) => c.source === source && c.destination === dest)) {
    return false;
  }
  if (scope.allowedCurrencies.length === 0) {
    return false;
  }
  return scope.allowedCurrencies.includes(source) && scope.allowedCurrencies.includes(dest);
}

export function mandateAllowsAmount(
  scope: MandateScope,
  amountMinorUnits: string,
  asset: string,
): boolean {
  if (asset.toUpperCase() !== scope.spendCapAsset) {
    return false;
  }
  return BigInt(amountMinorUnits) <= BigInt(scope.spendCapMinorUnits);
}

export function mandateAllowsBeneficiary(scope: MandateScope, recipientCode: string): boolean {
  if (scope.allowedBeneficiaries.length === 0) {
    return false;
  }
  return scope.allowedBeneficiaries.includes(recipientCode) ||
    scope.allowedBeneficiaries.includes(recipientCode.toLowerCase()) ||
    scope.allowedBeneficiaries.includes(recipientCode.toUpperCase());
}

export function mandateAllowsRoute(
  scope: MandateScope,
  sourceAsset: string,
  destinationAsset: string,
  amountMinorUnits: string,
  route: Pick<ScoredMultiRailRoute, 'quote' | 'sendAmount'>,
): boolean {
  if (!mandateAllowsCorridor(scope, sourceAsset, destinationAsset)) {
    return false;
  }
  if (!mandateAllowsAmount(scope, amountMinorUnits, sourceAsset)) {
    return false;
  }
  const quoteSource = route.quote.sourceAsset.toUpperCase();
  const quoteTarget = route.quote.targetAsset.toUpperCase();
  if (!scope.allowedCurrencies.includes(quoteSource) || !scope.allowedCurrencies.includes(quoteTarget)) {
    return false;
  }
  const sendAsset = route.sendAmount.asset.toUpperCase();
  if (sendAsset === scope.spendCapAsset && route.sendAmount.minorUnits > BigInt(scope.spendCapMinorUnits)) {
    return false;
  }
  return true;
}

export function filterRoutingByMandate(
  routing: MultiRailRouting,
  scope: MandateScope,
): MultiRailRouting {
  const kept = routing.routes.filter((route) =>
    mandateAllowsRoute(
      scope,
      routing.request.sourceAsset,
      routing.request.destinationAsset,
      routing.request.amountMinorUnits,
      route,
    ),
  );
  const reranked = kept.map((route, index) => ({
    ...route,
    rank: index + 1,
    recommended: index === 0,
  }));
  const recommended = reranked[0] ?? null;
  return {
    ...routing,
    routes: reranked,
    recommendedRoute: recommended,
    routeScore: recommended?.routeScore ?? null,
    estimatedCost: recommended?.totalCost ?? null,
    estimatedReceiveAmount: recommended?.deliveredAmount ?? null,
    estimatedSettlementTime: recommended?.settlement ?? null,
    routeExplanation: recommended?.routeExplanation ?? routing.routeExplanation,
  };
}

export function asJsonObject(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Mandate payload must be a JSON object.', { failClosed: true });
  }
  return value as JsonObject;
}
