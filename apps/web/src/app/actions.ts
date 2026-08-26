'use server';

import { createComparison, replayComparison } from '@/lib/api/client';
import type { ApiResult, ComparisonDto, ReplayResultDto } from '@/lib/api/types';

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
    'web-app',
  );
}

/** Re-runs a stored comparison through the engine and reports whether it reproduced. */
export async function verifyComparison(comparisonId: string): Promise<ApiResult<ReplayResultDto>> {
  return replayComparison(comparisonId);
}
