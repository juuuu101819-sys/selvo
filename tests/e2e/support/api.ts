import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * Typed access to a JSON response body.
 *
 * Playwright's `response.json()` returns `any`, which would quietly disable type checking across the
 * whole end-to-end suite — including on the money fields these tests exist to protect. Parsing
 * through a declared shape keeps the specs as strictly typed as the rest of the codebase.
 */
export async function jsonBody<TBody>(response: APIResponse): Promise<TBody> {
  return (await response.json()) as TBody;
}

/** Documented sandbox operator. Same class of secret as the README demo login. */
export const DEMO_EMAIL = 'treasury@demo-trading.example.invalid';
export const DEMO_PASSWORD = 'MeridianDemo!2026';
export const DEMO_AGENT_ID = 'agt_demo_treasury';
export const DEMO_AGENT_SECRET = 'mag_demo_agent01_sandbox_only_not_production';
export const DEMO_AGENT_KEY_PREFIX = 'mag_demo_agent01';

export const TRADFI_RAILS = ['bank_fx', 'payment_institution', 'liquidity_provider'] as const;
export const STABLECOIN_RAILS = ['stablecoin_settlement'] as const;
export const ALLOWED_DEMO_PROVIDERS = [
  'sandbox-veridian-payments',
  'sandbox-solstice-settlement',
] as const;
export const UNAVAILABLE_TO_DEMO_AGENT = [
  'sandbox-northgate-bank',
  'sandbox-meridian-liquidity',
] as const;

export interface MoneyBody {
  readonly minorUnits: string;
  readonly currency: string;
  readonly decimal: string;
  readonly exponent: number;
}

export interface HealthBody {
  readonly status: string;
  readonly service: string;
  readonly version: string;
}

export interface ReadyBody {
  readonly status: string;
  readonly service: string;
  readonly checks: { readonly persistence: string };
}

export interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

export interface ComparisonRouteBody {
  readonly routeId: string;
  readonly rank: number;
  readonly recommended: boolean;
  readonly provider: { readonly id: string; readonly name: string; readonly rail: string };
  readonly deliveredAmount: MoneyBody;
  readonly totalCost: MoneyBody;
  readonly totalCostBps: string;
  readonly slippageBps: string;
  readonly score: string;
  readonly scoreComponents: {
    readonly cost: string;
    readonly speed: string;
    readonly reliability: string;
    readonly liquidity?: string;
    readonly settlementConfidence?: string;
    readonly slippage?: string;
    readonly risk?: string;
  };
}

export interface ComparisonBody {
  readonly data: {
    readonly comparisonId: string;
    readonly fingerprint: string;
    readonly engineVersion: string;
    readonly recommendedRouteId: string | null;
    readonly routes: readonly ComparisonRouteBody[];
  };
  readonly meta: { readonly mode: string; readonly disclaimer: string };
}

export interface ReplayBody {
  readonly data: {
    readonly reproducible: boolean;
    readonly originalFingerprint: string;
    readonly replayedFingerprint: string;
  };
}

export interface AuditTrailBody {
  readonly data: {
    readonly comparisonId: string;
    readonly events: readonly { readonly type: string; readonly actor: string }[];
  };
}

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details: Record<string, unknown>;
    readonly requestId: string;
  };
}

export interface MetaCapabilities {
  readonly executeTransactions: boolean;
  readonly delegateExecution: boolean;
  readonly custodyFunds: boolean;
  readonly holdCryptoAssets: boolean;
  readonly holdPrivateKeys: boolean;
  readonly controlCustomerWallets: boolean;
  readonly operateAsPrincipal: boolean;
  readonly defiExecution: boolean;
  readonly compareRoutes: boolean;
  readonly multiRailRouting: boolean;
  readonly agentPayments: boolean;
  readonly paymentPolicyEngine: boolean;
  readonly executionIntents: boolean;
}

export interface MetaBody {
  readonly data: {
    readonly engineVersion: string;
    readonly routingEngineVersion: string;
    readonly graphEngineVersion: string;
    readonly stablecoinRoutingEngineVersion: string;
    readonly defiRoutingEngineVersion: string;
    readonly capabilities: MetaCapabilities;
    readonly execution: { readonly implemented: boolean; readonly statusCode: number };
  };
}

export interface MultiRailRouteBody {
  readonly routeId: string;
  readonly executable: boolean;
  readonly conversionKind: string;
  readonly slippageBps: string;
  readonly provider: { readonly id: string; readonly name: string; readonly railFamily: string };
}

export interface MultiRailBody {
  readonly routingEngineVersion: string;
  readonly aiUsed: boolean;
  readonly executable?: boolean;
  readonly routes: readonly MultiRailRouteBody[];
  readonly recommendedRoute: { readonly routeId: string } | null;
}

export interface StablecoinRouteBody {
  readonly conversionKind: string;
  readonly executable: boolean;
  readonly custody: boolean;
  readonly connectedToMainnet: boolean;
  readonly privateKeysGenerated: boolean;
  readonly provider: { readonly id: string; readonly name: string; readonly railFamily: string };
  readonly asset: { readonly source: string; readonly destination: string };
}

export interface StablecoinRoutingBody {
  readonly stablecoinRoutingEngineVersion: string;
  readonly conversionKind: string;
  readonly custody: boolean;
  readonly connectedToMainnet: boolean;
  readonly walletsCreated: boolean;
  readonly privateKeysGenerated: boolean;
  readonly executable: boolean;
  readonly routes: readonly StablecoinRouteBody[];
}

export interface DefiRouteBody {
  readonly routeKind: string;
  readonly venueKind: string | null;
  readonly executable: boolean;
  readonly swapSubmitted: boolean;
  readonly custody: boolean;
  readonly privateKeysGenerated: boolean;
  readonly walletsConnected: boolean;
  readonly provider: { readonly id: string; readonly category: string };
}

export interface DefiRoutingBody {
  readonly defiRoutingEngineVersion: string;
  readonly comparedFamilies: readonly string[];
  readonly custody: boolean;
  readonly connectedToMainnet: boolean;
  readonly walletsCreated: boolean;
  readonly walletsConnected: boolean;
  readonly privateKeysGenerated: boolean;
  readonly swapSubmitted: boolean;
  readonly executable: boolean;
  readonly routes: readonly DefiRouteBody[];
}

export interface GraphSearchBody {
  readonly graphEngineVersion: string;
  readonly aiUsed: boolean;
  readonly executable: boolean;
  readonly paths: readonly {
    readonly hops: number;
    readonly assets: readonly string[];
    readonly providers: readonly string[];
    readonly executable: boolean;
  }[];
  readonly rejections: readonly { readonly reason: string }[];
}

export interface QuotedRouteBody {
  readonly routeId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly rail: string;
  readonly recommended: boolean;
  readonly totalCostBps: string;
  readonly expiresAt: string | null;
  readonly routeScore: string | null;
  readonly slippageBps: string | null;
  readonly liquidityHeadroom: string | null;
}

export interface PaymentIntentBody {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly status: string;
  readonly recipient: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amount: { readonly minorUnits: string; readonly asset: string };
  readonly quotedRoutes: readonly QuotedRouteBody[];
  readonly quoteExpiresAt: string | null;
  readonly selectedRouteId: string | null;
  readonly fundsMoved: boolean;
  readonly custody: boolean;
  readonly realExecution: boolean;
  readonly simulation: {
    readonly simulated: boolean;
    readonly fundsMoved: boolean;
    readonly custody: boolean;
    readonly realExecution: boolean;
    readonly providerId: string;
  } | null;
}

export interface ExecutionIntentBody {
  readonly id: string;
  readonly status: string;
  readonly executable: boolean;
  readonly submitted: boolean;
  readonly quoteExpiresAt: string | null;
  readonly routeId: string;
}

export interface NlRouteBody {
  readonly paymentIntent: PaymentIntentBody;
  readonly selectedRoute: { readonly routeId: string; readonly providerId: string } | null;
  readonly executionIntent: ExecutionIntentBody;
  readonly pipelineCompleted: readonly string[];
  readonly fundsMoved: boolean;
  readonly custody: boolean;
  readonly realExecution: boolean;
  readonly executable: boolean;
  readonly submitted: boolean;
  readonly aiUsed: boolean;
}

export interface IssuedAgentBody {
  readonly id: string;
  readonly secret: string;
  readonly keyPrefix: string | null;
}

export function uniqueIdempotencyKey(label: string): string {
  return `e2e-${label}-${crypto.randomUUID()}`;
}

export function agentHeaders(
  overrides: Record<string, string> = {},
  secret: string = DEMO_AGENT_SECRET,
): Record<string, string> {
  return { 'x-api-key': secret, ...overrides };
}

export function bearerHeaders(
  token: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...overrides };
}

export async function loginDemoOperator(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/v1/auth/login', {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  expect(response.status()).toBe(201);
  return (await jsonBody<Envelope<{ token: string }>>(response)).data.token;
}

/** Owner/admin session mints an organization key that can record execution intents. */
export async function mintTransactionCreateKey(
  request: APIRequestContext,
  token: string,
): Promise<string> {
  const minted = await request.post('/api/v1/api-keys', {
    headers: bearerHeaders(token),
    data: { label: 'e2e execution intents', scopes: ['transaction:create'] },
  });
  expect(minted.status()).toBe(201);
  return (await jsonBody<Envelope<{ secret: string }>>(minted)).data.secret;
}

export async function expectError(
  response: APIResponse,
  status: number,
  code: string,
): Promise<ErrorBody> {
  expect(response.status()).toBe(status);
  const body = await jsonBody<ErrorBody>(response);
  expect(body.error.code).toBe(code);
  return body;
}

export function assertDigitMinorUnits(value: string): void {
  expect(value).toMatch(/^\d+$/);
}

export function assertNonCustodialText(payload: unknown, extraForbidden: readonly string[] = []): void {
  const text = JSON.stringify(payload);
  expect(text).not.toMatch(/"privateKey"\s*:/);
  expect(text).not.toMatch(/private_key|mnemonic|seedPhrase|walletSecret/i);
  expect(text).not.toContain(DEMO_AGENT_SECRET);
  expect(text).not.toContain(DEMO_PASSWORD);
  for (const secret of extraForbidden) {
    expect(text).not.toContain(secret);
  }
}

export function assertNeverExecutes(flags: {
  readonly fundsMoved?: boolean;
  readonly custody?: boolean;
  readonly realExecution?: boolean;
  readonly executable?: boolean;
  readonly submitted?: boolean;
  readonly swapSubmitted?: boolean;
  readonly privateKeysGenerated?: boolean;
  readonly walletsCreated?: boolean;
  readonly walletsConnected?: boolean;
  readonly connectedToMainnet?: boolean;
}): void {
  if (flags.fundsMoved !== undefined) {
    expect(flags.fundsMoved).toBe(false);
  }
  if (flags.custody !== undefined) {
    expect(flags.custody).toBe(false);
  }
  if (flags.realExecution !== undefined) {
    expect(flags.realExecution).toBe(false);
  }
  if (flags.executable !== undefined) {
    expect(flags.executable).toBe(false);
  }
  if (flags.submitted !== undefined) {
    expect(flags.submitted).toBe(false);
  }
  if (flags.swapSubmitted !== undefined) {
    expect(flags.swapSubmitted).toBe(false);
  }
  if (flags.privateKeysGenerated !== undefined) {
    expect(flags.privateKeysGenerated).toBe(false);
  }
  if (flags.walletsCreated !== undefined) {
    expect(flags.walletsCreated).toBe(false);
  }
  if (flags.walletsConnected !== undefined) {
    expect(flags.walletsConnected).toBe(false);
  }
  if (flags.connectedToMainnet !== undefined) {
    expect(flags.connectedToMainnet).toBe(false);
  }
}

export function defined<T>(value: T | undefined | null, message: string): T {
  expect(value).not.toBeNull();
  expect(value).toBeDefined();
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}
