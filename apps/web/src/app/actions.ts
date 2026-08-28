'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { acceptInvite, createComparison, createDeFiRoute, createFinancialQuote, createOrganizationApiKey, createPaymentIntent, createRoute, createStablecoinRoute, discoverGraphPaths, interpretAgentInstruction, login, logout, quotePaymentIntent, replayComparison, revokeOrganizationApiKey, routeAgentInstruction, searchRoutes, selectPaymentRoute, authorizePaymentIntent, simulatePaymentIntent, submitOnboardingKyb, updateAgentPolicy, verifyMfa, startOidcLogin, completeOidcLogin, enrollMfa, confirmMfa, regenerateMfaRecovery, updateOrgAuthSettings } from '@/lib/api/client';
import type { AcceptInviteDto, ApiResult, AgentPolicyControlsDto, ComparisonDto, DefiRoutingDto, FinancialQuoteDto, GraphSearchDto, IssuedApiKeyDto, KybSubmitDto, LoginDto, MfaChallengeDto, MfaConfirmDto, MfaEnrollDto, MultiRailRoutingDto, NlInterpretDto, NlRouteResultDto, OrgAuthSettingsDto, PaymentIntentDto, ReplayResultDto, RouteSearchDto, StablecoinRoutingDto } from '@/lib/api/types';
import { isMfaChallenge } from '@/lib/api/types';
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

export async function evaluateDefiRoutes(input: {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amount: string;
}): Promise<ApiResult<DefiRoutingDto>> {
  const authorization = await readSessionToken();
  return createDeFiRoute(
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
): Promise<ApiResult<{ signedIn: true } | MfaChallengeDto>> {
  const result = await login(email, password);
  if (!result.ok) {
    return result;
  }
  if (isMfaChallenge(result.data)) {
    return { ok: true, data: result.data, disclaimer: result.disclaimer };
  }
  await writeSessionCookie(result.data.token, result.data.expiresAt);
  redirect(safeDashboardPath(nextPath));
}

export async function completeMfaSignIn(
  challengeToken: string,
  code: string,
  nextPath: string,
): Promise<ApiResult<{ signedIn: true }>> {
  const result = await verifyMfa(challengeToken, code);
  if (!result.ok) {
    return result;
  }
  await writeSessionCookie(result.data.token, result.data.expiresAt);
  redirect(safeDashboardPath(nextPath));
}

export async function beginSsoSignIn(
  organizationSlug: string,
): Promise<ApiResult<{ authorizationUrl: string }>> {
  return startOidcLogin(organizationSlug);
}

export async function completeSsoSignIn(
  code: string,
  state: string,
  nextPath: string,
): Promise<ApiResult<LoginDto>> {
  const result = await completeOidcLogin(code, state);
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

export async function createOrganizationKey(input: {
  readonly label: string;
  readonly scopes: readonly string[];
}): Promise<ApiResult<IssuedApiKeyDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return {
      ok: false,
      failure: {
        code: 'UNAUTHENTICATED',
        message: 'Sign in to issue an API key.',
        details: {},
        requestId: null,
      },
    };
  }
  return createOrganizationApiKey({ label: input.label, scopes: input.scopes }, token);
}

function unauthenticated<T>(): ApiResult<T> {
  return {
    ok: false,
    failure: {
      code: 'UNAUTHENTICATED',
      message: 'Sign in to continue.',
      details: {},
      requestId: null,
    },
  };
}

export async function startMfaEnrollment(): Promise<ApiResult<MfaEnrollDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return unauthenticated();
  }
  return enrollMfa(token);
}

export async function confirmMfaEnrollment(code: string): Promise<ApiResult<MfaConfirmDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return unauthenticated();
  }
  const result = await confirmMfa(token, code);
  if (result.ok) {
    revalidatePath('/dashboard/settings');
  }
  return result;
}

export async function regenerateRecoveryCodes(
  code: string,
): Promise<ApiResult<{ recoveryCodes: readonly string[] }>> {
  const token = await readSessionToken();
  if (token === null) {
    return unauthenticated();
  }
  return regenerateMfaRecovery(token, code);
}

export async function saveOrgAuthSettings(input: {
  readonly requireMfaForPrivilegedRoles?: boolean;
  readonly oidc?: {
    readonly issuer?: string;
    readonly clientId?: string;
    readonly clientSecret?: string;
    readonly redirectUri?: string;
    readonly enabled?: boolean;
  };
}): Promise<ApiResult<OrgAuthSettingsDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return unauthenticated();
  }
  const result = await updateOrgAuthSettings(token, input);
  if (result.ok) {
    revalidatePath('/dashboard/settings');
  }
  return result;
}

export async function revokeOrganizationKey(
  id: string,
): Promise<ApiResult<{ id: string; revoked: true }>> {
  const token = await readSessionToken();
  if (token === null) {
    return {
      ok: false,
      failure: {
        code: 'UNAUTHENTICATED',
        message: 'Sign in to revoke an API key.',
        details: {},
        requestId: null,
      },
    };
  }
  return revokeOrganizationApiKey(id, token);
}

export async function quoteFinancialRoute(input: {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amount: string;
}): Promise<ApiResult<FinancialQuoteDto>> {
  const authorization = await readSessionToken();
  return createFinancialQuote(input, { actor: 'web-app', authorization });
}

export async function searchFinancialRoutes(input: {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
}): Promise<ApiResult<RouteSearchDto>> {
  const authorization = await readSessionToken();
  return searchRoutes(input, { actor: 'web-app', authorization });
}

export async function createAgentPaymentIntent(input: {
  readonly agentId: string;
  readonly instruction: string;
}): Promise<ApiResult<PaymentIntentDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return {
      ok: false,
      failure: {
        code: 'UNAUTHENTICATED',
        message: 'Sign in to create an agent payment intent.',
        details: {},
        requestId: null,
      },
    };
  }
  return createPaymentIntent(input, {
    authorization: token,
    idempotencyKey: `web-${input.agentId}-${Date.now()}`,
  });
}

export async function quoteAgentPaymentIntent(id: string): Promise<ApiResult<PaymentIntentDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return unauthenticatedPayment();
  }
  return quotePaymentIntent(id, token);
}

export async function selectAgentPaymentRoute(
  id: string,
  routeId: string,
): Promise<ApiResult<PaymentIntentDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return unauthenticatedPayment();
  }
  return selectPaymentRoute(id, routeId, token);
}

export async function authorizeAgentPaymentIntent(id: string): Promise<ApiResult<PaymentIntentDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return unauthenticatedPayment();
  }
  return authorizePaymentIntent(id, token);
}

export async function simulateAgentPaymentIntent(id: string): Promise<ApiResult<PaymentIntentDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return unauthenticatedPayment();
  }
  return simulatePaymentIntent(id, token);
}

export async function interpretAgentPaymentInstruction(input: {
  readonly agentId: string;
  readonly instruction: string;
}): Promise<ApiResult<NlInterpretDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return unauthenticatedPayment();
  }
  return interpretAgentInstruction(input, { authorization: token });
}

export async function routeAgentPaymentInstruction(input: {
  readonly agentId: string;
  readonly instruction: string;
}): Promise<ApiResult<NlRouteResultDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return unauthenticatedPayment();
  }
  return routeAgentInstruction(input, {
    authorization: token,
    idempotencyKey: `web-nl-${input.agentId}-${Date.now()}`,
  });
}

function unauthenticatedPayment<T>(): ApiResult<T> {
  return {
    ok: false,
    failure: {
      code: 'UNAUTHENTICATED',
      message: 'Sign in to continue the agent payment flow.',
      details: {},
      requestId: null,
    },
  };
}

export async function acceptOrganizationInvite(input: {
  readonly token: string;
  readonly password: string;
  readonly displayName?: string;
}): Promise<ApiResult<AcceptInviteDto>> {
  return acceptInvite({
    token: input.token,
    password: input.password,
    ...(input.displayName === undefined || input.displayName.trim() === ''
      ? {}
      : { displayName: input.displayName.trim() }),
  });
}

export async function submitKybForReview(): Promise<ApiResult<KybSubmitDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return {
      ok: false,
      failure: {
        code: 'UNAUTHENTICATED',
        message: 'Sign in to submit KYB for review.',
        details: {},
        requestId: null,
      },
    };
  }
  const result = await submitOnboardingKyb(token);
  if (result.ok) {
    revalidatePath('/dashboard/onboarding');
  }
  return result;
}

export async function saveAgentPolicy(
  agentId: string,
  input: {
    readonly maxTransactionAmountMinorUnits?: string;
    readonly dailySpendingLimitMinorUnits?: string;
    readonly dailySpendingAsset?: string;
    readonly allowedAssets?: readonly string[];
    readonly allowedRecipientCodes?: readonly string[];
    readonly allowedProviderIds?: readonly string[];
    readonly preferredRoutePreference?: string | null;
  },
): Promise<ApiResult<AgentPolicyControlsDto>> {
  const token = await readSessionToken();
  if (token === null) {
    return unauthenticatedPayment();
  }
  const result = await updateAgentPolicy(agentId, input, token);
  if (result.ok) {
    revalidatePath(`/dashboard/agents/${agentId}`);
    revalidatePath(`/dashboard/agents/${agentId}/policies`);
    revalidatePath('/dashboard/agents');
  }
  return result;
}
