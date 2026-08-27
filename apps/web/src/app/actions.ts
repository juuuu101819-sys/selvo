'use server';

import { redirect } from 'next/navigation';
import { createComparison, createRoute, createStablecoinRoute, discoverGraphPaths, login, logout, replayComparison } from '@/lib/api/client';
import type { ApiResult, ComparisonDto, GraphSearchDto, MultiRailRoutingDto, ReplayResultDto, StablecoinRoutingDto } from '@/lib/api/types';
import {
  clearSessionCookie,
  readSessionToken,
  safeDashboardPath,
  writeSessionCookie,
} from '@/lib/session';

export interface CompareRoutesInput {
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly amount: string;
  readonly rails: readonly string[];
  readonly weights: { readonly cost: string; readonly speed: string; readonly reliability: string };
}

/**
 * Server actions bridging the UI to the API.
 *
 * Keeping the call on the server means the browser never holds the API's address and the app works
 * without a CORS grant. Failures are returned as data, not thrown, so the form can render a precise
 * message — a rejected amount and an API that is not running need very different responses from the
 * person using the app.
 */
export async function compareRoutes(input: CompareRoutesInput): Promise<ApiResult<ComparisonDto>> {
  const authorization = await readSessionToken();
  return createComparison(
    {
      sourceCurrency: input.sourceCurrency,
      targetCurrency: input.targetCurrency,
      amount: input.amount,
      // An empty rail list means "no filter": sending `[]` would be rejected by the API, which is
      // the correct behaviour for an explicitly empty selection.
      ...(input.rails.length > 0 ? { rails: [...input.rails] } : {}),
      weights: input.weights,
    },
    { actor: 'web-app', authorization },
  );
}

export async function evaluateRoutes(input: {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amount: string;
}): Promise<ApiResult<MultiRailRoutingDto>> {
  const authorization = await readSessionToken();
  return createRoute(
    {
      sourceAsset: input.sourceAsset,
      destinationAsset: input.destinationAsset,
      amount: input.amount,
    },
    { actor: 'web-app', authorization },
  );
}

export async function discoverGraphRoutes(input: {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly maxHops: number;
  readonly maxExpectedCostBps: string;
  readonly minLiquidity: string;
}): Promise<ApiResult<GraphSearchDto>> {
  const authorization = await readSessionToken();
  return discoverGraphPaths(
    {
      sourceAsset: input.sourceAsset,
      destinationAsset: input.destinationAsset,
      constraints: {
        maxHops: input.maxHops,
        ...(input.maxExpectedCostBps.trim() === ''
          ? {}
          : { maxExpectedCostBps: input.maxExpectedCostBps.trim() }),
        ...(input.minLiquidity.trim() === '' ? {} : { minLiquidity: input.minLiquidity.trim() }),
      },
    },
    { actor: 'web-app', authorization },
  );
}

export async function evaluateStablecoinRoutes(input: {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amount: string;
}): Promise<ApiResult<StablecoinRoutingDto>> {
  const authorization = await readSessionToken();
  return createStablecoinRoute(
    {
      sourceAsset: input.sourceAsset,
      destinationAsset: input.destinationAsset,
      amount: input.amount,
    },
    { actor: 'web-app', authorization },
  );
}
export async function verifyComparison(comparisonId: string): Promise<ApiResult<ReplayResultDto>> {
  const authorization = await readSessionToken();
  return replayComparison(comparisonId, authorization);
}

export async function signIn(
  email: string,
  password: string,
  nextPath: string,
): Promise<ApiResult<{ signedIn: true }>> {
  const result = await login(email, password);
  if (!result.ok) {
    return result;
  }
  await writeSessionCookie(result.data.token, result.data.expiresAt);
  redirect(safeDashboardPath(nextPath));
}

export async function signOut(): Promise<void> {
  const token = await readSessionToken();
  if (token !== null) {
    await logout(token);
  }
  await clearSessionCookie();
  redirect('/login');
}
