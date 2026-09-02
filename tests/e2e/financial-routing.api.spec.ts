import { expect, test } from '@playwright/test';
import {
  ALLOWED_DEMO_PROVIDERS,
  DEMO_AGENT_ID,
  DEMO_AGENT_KEY_PREFIX,
  DEMO_AGENT_SECRET,
  STABLECOIN_RAILS,
  TRADFI_RAILS,
  UNAVAILABLE_TO_DEMO_AGENT,
  agentHeaders,
  assertDigitMinorUnits,
  assertNeverExecutes,
  assertNonCustodialText,
  bearerHeaders,
  defined,
  expectError,
  jsonBody,
  loginDemoOperator,
  mintTransactionCreateKey,
  uniqueIdempotencyKey,
  type AuditTrailBody,
  type ComparisonBody,
  type DefiRoutingBody,
  type Envelope,
  type ExecutionIntentBody,
  type GraphSearchBody,
  type IssuedAgentBody,
  type MetaBody,
  type MultiRailBody,
  type NlRouteBody,
  type PaymentIntentBody,
  type ReplayBody,
  type StablecoinRoutingBody,
} from './support/api.js';

const USD_100K_KRW = {
  sourceCurrency: 'USD',
  targetCurrency: 'KRW',
  amount: '100000.00',
} as const;

test.describe('CASE 1 — USD 100,000 → KRW compares traditional FX and stablecoin', () => {
  test('ranks tradfi and stablecoin settlement on the same comparison', async ({ request }) => {
    const created = await request.post('/api/v1/comparisons', { data: { ...USD_100K_KRW } });
    expect(created.status()).toBe(201);
    const body = await jsonBody<ComparisonBody>(created);
    expect(body.data.engineVersion).toBe('2.0.0');
    expect(body.data.routes.length).toBeGreaterThan(1);

    const rails = new Set(body.data.routes.map((route) => route.provider.rail));
    expect(
      [...rails].some((rail) => (TRADFI_RAILS as readonly string[]).includes(rail)),
    ).toBe(true);
    expect(
      [...rails].some((rail) => (STABLECOIN_RAILS as readonly string[]).includes(rail)),
    ).toBe(true);
    expect(body.data.routes.some((route) => route.provider.id === 'sandbox-solstice-settlement')).toBe(
      true,
    );
    expect(
      body.data.routes.some(
        (route) =>
          route.provider.rail === 'bank_fx' || route.provider.rail === 'payment_institution',
      ),
    ).toBe(true);

    for (const route of body.data.routes) {
      assertDigitMinorUnits(route.deliveredAmount.minorUnits);
      assertDigitMinorUnits(route.totalCost.minorUnits);
    }
    expect(body.data.recommendedRouteId).toBe(body.data.routes[0]?.routeId);
    assertNonCustodialText(body);

    const tradfi = await request.post('/api/v1/comparisons', {
      data: { ...USD_100K_KRW, railFamilies: ['tradfi'] },
    });
    expect(tradfi.status()).toBe(201);
    const tradfiBody = await jsonBody<ComparisonBody>(tradfi);
    expect(
      tradfiBody.data.routes.every((route) =>
        (TRADFI_RAILS as readonly string[]).includes(route.provider.rail),
      ),
    ).toBe(true);
    expect(tradfiBody.data.routes.map((route) => route.provider.rail)).not.toContain(
      'stablecoin_settlement',
    );

    const stablecoin = await request.post('/api/v1/comparisons', {
      data: { ...USD_100K_KRW, railFamilies: ['stablecoin'] },
    });
    expect(stablecoin.status()).toBe(201);
    const stablecoinBody = await jsonBody<ComparisonBody>(stablecoin);
    expect(
      stablecoinBody.data.routes.every((route) => route.provider.rail === 'stablecoin_settlement'),
    ).toBe(true);

    const replayed = await request.post(`/api/v1/comparisons/${body.data.comparisonId}/replay`, {
      headers: { 'content-type': 'application/json' },
    });
    expect(replayed.status()).toBe(200);
    const replay = await jsonBody<ReplayBody>(replayed);
    expect(replay.data.reproducible).toBe(true);
    expect(replay.data.replayedFingerprint).toBe(body.data.fingerprint);

    const audit = await request.get(`/api/v1/comparisons/${body.data.comparisonId}/audit`);
    expect(audit.status()).toBe(200);
    const trail = await jsonBody<AuditTrailBody>(audit);
    const types = trail.data.events.map((event) => event.type);
    expect(types).toContain('comparison.requested');
    expect(types).toContain('comparison.completed');
    expect(types).toContain('provider.quote.received');
  });
});

test.describe('CASE 2 — USD → USDC compares a stablecoin provider and DEX venues', () => {
  test('quotes the Helios ramp for USD→USDC and compares DEX venues where both exist', async ({
    request,
  }) => {
    const ramp = await request.post('/api/v1/stablecoin-routes', {
      data: { sourceAsset: 'USD', destinationAsset: 'USDC', amount: '10000.00' },
    });
    expect(ramp.status()).toBe(201);
    const rampBody = await jsonBody<Envelope<StablecoinRoutingBody>>(ramp);
    expect(rampBody.data.stablecoinRoutingEngineVersion).toBe('1.0.0');
    expect(rampBody.data.conversionKind).toBe('fiat_stablecoin');
    expect(rampBody.data.routes.some((route) => route.provider.id === 'demo-helios-ramp')).toBe(true);
    expect(rampBody.data.routes.every((route) => route.conversionKind === 'fiat_stablecoin')).toBe(
      true,
    );
    assertNeverExecutes(rampBody.data);
    for (const route of rampBody.data.routes) {
      assertNeverExecutes(route);
    }

    const defiUsd = await request.post('/api/v1/defi-routes', {
      data: { sourceAsset: 'USD', destinationAsset: 'USDC', amount: '10000.00' },
    });
    expect(defiUsd.status()).toBe(201);
    const defiUsdBody = await jsonBody<Envelope<DefiRoutingBody>>(defiUsd);
    expect(defiUsdBody.data.comparedFamilies).toEqual(['stablecoin']);
    expect(defiUsdBody.data.routes.some((route) => route.provider.id === 'demo-helios-ramp')).toBe(
      true,
    );
    expect(defiUsdBody.data.routes.every((route) => route.routeKind !== 'dex')).toBe(true);

    // Demo DEX books do not price USD→USDC. The pair where a stablecoin venue and a DEX both
    // quote is USDC→USDT: the ramp/stablecoin layer and the DeFi layer are compared there.
    const stablecoin = await request.post('/api/v1/stablecoin-routes', {
      data: { sourceAsset: 'USDC', destinationAsset: 'USDT', amount: '10000' },
    });
    expect(stablecoin.status()).toBe(201);
    const stablecoinBody = await jsonBody<Envelope<StablecoinRoutingBody>>(stablecoin);
    expect(stablecoinBody.data.conversionKind).toBe('stablecoin_stablecoin');
    expect(stablecoinBody.data.routes.map((route) => route.provider.id).sort()).toEqual([
      'demo-horizon-aggregator',
      'demo-meridian-pool',
      'demo-ridgeline-dex',
    ]);

    const defi = await request.post('/api/v1/defi-routes', {
      data: { sourceAsset: 'USDC', destinationAsset: 'USDT', amount: '10000' },
    });
    expect(defi.status()).toBe(201);
    const defiBody = await jsonBody<Envelope<DefiRoutingBody>>(defi);
    expect(defiBody.data.defiRoutingEngineVersion).toBe('1.0.0');
    expect(defiBody.data.comparedFamilies).toContain('defi');
    const kinds = defiBody.data.routes.map((route) => route.routeKind).sort();
    expect(kinds).toEqual(['aggregator', 'amm', 'dex']);
    assertNeverExecutes(defiBody.data);
    for (const route of defiBody.data.routes) {
      assertNeverExecutes(route);
    }
    assertNonCustodialText(defiBody);
  });
});

test.describe('CASE 3 — AI agent Pay 500 USD', () => {
  test('walks agent → intent → policy → quote → route → execution intent → demo provider', async ({
    request,
  }) => {
    const idempotencyKey = uniqueIdempotencyKey('pay-500');
    const created = await request.post('/api/v1/payment-intents', {
      headers: agentHeaders({ 'idempotency-key': idempotencyKey }),
      data: { instruction: 'Pay 500 USD to merchant X', purpose: 'sandbox e2e payout' },
    });
    expect(created.status()).toBe(201);
    const intent = await jsonBody<Envelope<PaymentIntentBody>>(created);
    expect(intent.data.status).toBe('CREATED');
    expect(intent.data.recipient).toBe('merchant-x');
    expect(intent.data.sourceAsset).toBe('USD');
    expect(intent.data.amount.minorUnits).toBe('50000');
    expect(intent.data.agentId).toBe(DEMO_AGENT_ID);
    assertNeverExecutes(intent.data);
    assertNonCustodialText(intent);

    const quoted = await request.post(`/api/v1/payment-intents/${intent.data.id}/quote`, {
      headers: agentHeaders(),
    });
    expect(quoted.status()).toBe(200);
    const quotedBody = await jsonBody<Envelope<PaymentIntentBody>>(quoted);
    expect(quotedBody.data.status).toBe('QUOTED');
    expect(quotedBody.data.quotedRoutes.length).toBeGreaterThan(0);
    const route = defined(quotedBody.data.quotedRoutes[0], 'quoted route');
    expect(route.routeScore).not.toBeNull();
    expect(route.slippageBps).not.toBeNull();

    const selected = await request.post(`/api/v1/payment-intents/${intent.data.id}/select`, {
      headers: agentHeaders(),
      data: { routeId: route.routeId },
    });
    expect(selected.status()).toBe(200);
    expect((await jsonBody<Envelope<PaymentIntentBody>>(selected)).data.status).toBe('ROUTED');

    const authorized = await request.post(`/api/v1/payment-intents/${intent.data.id}/authorize`, {
      headers: agentHeaders(),
    });
    expect(authorized.status()).toBe(200);
    expect((await jsonBody<Envelope<PaymentIntentBody>>(authorized)).data.status).toBe(
      'POLICY_APPROVED',
    );

    const simulated = await request.post(`/api/v1/payment-intents/${intent.data.id}/simulate`, {
      headers: agentHeaders(),
    });
    expect(simulated.status()).toBe(200);
    const done = await jsonBody<Envelope<PaymentIntentBody>>(simulated);
    expect(done.data.status).toBe('SIMULATION_COMPLETED');
    assertNeverExecutes(done.data);
    const simulation = defined(done.data.simulation, 'sandbox simulation receipt');
    expect(simulation.simulated).toBe(true);
    expect(simulation.providerId).toMatch(/^sandbox-/);
    assertNeverExecutes(simulation);
    expect(simulated.headers()['content-type'] ?? '').toMatch(/json/);
    expect(await simulated.text()).not.toContain(DEMO_AGENT_SECRET);

    const token = await loginDemoOperator(request);
    const executionKey = await mintTransactionCreateKey(request, token);
    const recorded = await request.post('/api/v1/execution-intents', {
      headers: { 'x-api-key': executionKey },
      data: {
        requestId: uniqueIdempotencyKey('exec-500'),
        routeId: route.routeId,
        sourceAsset: 'USD',
        destinationAsset: quotedBody.data.destinationAsset,
        amount: '500.00',
        paymentIntentId: intent.data.id,
        ...(quotedBody.data.quoteExpiresAt === null
          ? {}
          : { quoteExpiresAt: quotedBody.data.quoteExpiresAt }),
      },
    });
    expect(recorded.status()).toBe(201);
    const executionIntent = await jsonBody<Envelope<ExecutionIntentBody>>(recorded);
    expect(executionIntent.data.status).toBe('recorded');
    assertNeverExecutes(executionIntent.data);

    const nl = await request.post('/api/v1/agent/route', {
      headers: agentHeaders({ 'idempotency-key': uniqueIdempotencyKey('nl-500') }),
      data: { instruction: 'Pay 500 USD to merchant X' },
    });
    expect(nl.status()).toBe(201);
    const nlBody = await jsonBody<Envelope<NlRouteBody>>(nl);
    expect(nlBody.data.pipelineCompleted).toEqual([
      'natural_language',
      'intent_parser',
      'structured_payment_intent',
      'policy_engine',
      'routing_engine',
      'provider_quote',
      'route_selection',
      'execution_intent',
    ]);
    expect(nlBody.data.paymentIntent.status).toBe('ROUTED');
    expect(nlBody.data.executionIntent.status).toBe('recorded');
    assertNeverExecutes(nlBody.data);
    assertNeverExecutes(nlBody.data.executionIntent);
    expect(nlBody.data.aiUsed).toBe(false);

    const executions = await request.post('/api/v1/executions', {
      headers: agentHeaders(),
      data: {},
    });
    await expectError(executions, 501, 'EXECUTION_NOT_IMPLEMENTED');
  });
});

test.describe('CASE 4 — AI agent exceeds spending limit', () => {
  test('fail-closes with POLICY_DENIED and does not quote', async ({ request }) => {
    const response = await request.post('/api/v1/payment-intents', {
      headers: agentHeaders({ 'idempotency-key': uniqueIdempotencyKey('too-large') }),
      data: { instruction: 'Pay 20000 USD to merchant X' },
    });
    const body = await expectError(response, 403, 'POLICY_DENIED');
    expect(body.error.details['rule']).toBe('maximum_transaction_amount');
    expect(body.error.details['failClosed']).toBe(true);
    assertNonCustodialText(body);
  });
});

test.describe('CASE 5 — Provider unavailable', () => {
  test('drops a disallowed venue and still evaluates an alternative path', async ({ request }) => {
    const fiatOnly = await request.post('/api/v1/route-graph/paths', {
      data: {
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        constraints: { maxHops: 3, supportedAssets: ['USD', 'KRW'] },
      },
    });
    expect(fiatOnly.status()).toBe(201);
    const fiatBody = await jsonBody<Envelope<GraphSearchBody>>(fiatOnly);
    expect(fiatBody.data.graphEngineVersion).toBe('1.0.0');
    expect(fiatBody.data.executable).toBe(false);
    expect(fiatBody.data.paths.length).toBeGreaterThan(0);
    expect(fiatBody.data.paths.every((path) => path.hops === 1)).toBe(true);
    expect(
      fiatBody.data.rejections.some((rejection) => rejection.reason === 'UNSUPPORTED_ASSET'),
    ).toBe(true);
    expect(
      fiatBody.data.paths.some((path) => path.providers.includes('sandbox-veridian-payments')),
    ).toBe(true);

    const created = await request.post('/api/v1/payment-intents', {
      headers: agentHeaders({ 'idempotency-key': uniqueIdempotencyKey('provider-filter') }),
      data: { instruction: 'Pay 500 USD to merchant X' },
    });
    const intent = await jsonBody<Envelope<PaymentIntentBody>>(created);
    const quoted = await request.post(`/api/v1/payment-intents/${intent.data.id}/quote`, {
      headers: agentHeaders(),
    });
    expect(quoted.status()).toBe(200);
    const quotedBody = await jsonBody<Envelope<PaymentIntentBody>>(quoted);
    const providerIds = quotedBody.data.quotedRoutes.map((route) => route.providerId);
    expect(providerIds.length).toBeGreaterThan(0);
    for (const providerId of providerIds) {
      expect(ALLOWED_DEMO_PROVIDERS as readonly string[]).toContain(providerId);
    }
    for (const blockedProvider of UNAVAILABLE_TO_DEMO_AGENT) {
      expect(providerIds).not.toContain(blockedProvider);
    }
  });
});

test.describe('CASE 6 — Quote expires', () => {
  test('rejects an execution intent whose quote timestamp is already in the past', async ({
    request,
  }) => {
    const token = await loginDemoOperator(request);
    const executionKey = await mintTransactionCreateKey(request, token);
    const response = await request.post('/api/v1/execution-intents', {
      headers: { 'x-api-key': executionKey },
      data: {
        requestId: uniqueIdempotencyKey('expired-exec'),
        routeId: 'rte_demo',
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '500.00',
        quoteExpiresAt: '2000-01-01T00:00:00.000Z',
      },
    });
    const body = await expectError(response, 409, 'QUOTE_EXPIRED');
    expect(body.error.details['quoteExpiresAt']).toBe('2000-01-01T00:00:00.000Z');
  });
});

test.describe('CASE 7 — Insufficient liquidity', () => {
  test('rejects graph paths that cannot clear the liquidity floor', async ({ request }) => {
    const response = await request.post('/api/v1/route-graph/paths', {
      data: {
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        constraints: { maxHops: 1, minLiquidity: '1000000000.00' },
      },
    });
    expect(response.status()).toBe(201);
    const body = await jsonBody<Envelope<GraphSearchBody>>(response);
    expect(body.data.paths).toHaveLength(0);
    expect(
      body.data.rejections.some((rejection) => rejection.reason === 'INSUFFICIENT_LIQUIDITY'),
    ).toBe(true);
    expect(body.data.executable).toBe(false);
  });

  test('fail-closes agent route selection when policy liquidity headroom is unmet', async ({
    request,
  }) => {
    const token = await loginDemoOperator(request);
    const minted = await request.post('/api/v1/agents', {
      headers: bearerHeaders(token),
      data: { name: 'E2E liquidity agent' },
    });
    expect(minted.status()).toBe(201);
    const issued = await jsonBody<Envelope<IssuedAgentBody>>(minted);
    const secret = issued.data.secret;
    expect(secret.startsWith('mag_')).toBe(true);

    const created = await request.post('/api/v1/payment-intents', {
      headers: agentHeaders({ 'idempotency-key': uniqueIdempotencyKey('liq-create') }, secret),
      data: { instruction: 'Pay 500 USD to merchant X' },
    });
    expect(created.status()).toBe(201);
    const intent = await jsonBody<Envelope<PaymentIntentBody>>(created);
    const quoted = await request.post(`/api/v1/payment-intents/${intent.data.id}/quote`, {
      headers: agentHeaders({}, secret),
    });
    expect(quoted.status()).toBe(200);
    const quotedBody = await jsonBody<Envelope<PaymentIntentBody>>(quoted);
    const routeId = defined(quotedBody.data.quotedRoutes[0]?.routeId, 'quoted route');

    const tightened = await request.patch(`/api/v1/dashboard/agents/${issued.data.id}/policies`, {
      headers: bearerHeaders(token),
      data: { minLiquidityHeadroom: '1000000' },
    });
    expect(tightened.status()).toBe(200);

    const selected = await request.post(`/api/v1/payment-intents/${intent.data.id}/select`, {
      headers: agentHeaders({}, secret),
      data: { routeId },
    });
    const denied = await expectError(selected, 403, 'POLICY_DENIED');
    expect(denied.error.details['rule']).toBe('minimum_liquidity');
    expect(denied.error.details['failClosed']).toBe(true);
  });
});

test.describe('CASE 8 — High slippage', () => {
  test('penalizes higher-slippage routes in the comparison score', async ({ request }) => {
    const created = await request.post('/api/v1/comparisons', { data: { ...USD_100K_KRW } });
    expect(created.status()).toBe(201);
    const body = await jsonBody<ComparisonBody>(created);
    const multi = await request.post('/api/v1/routes', {
      data: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '100000.00' },
    });
    expect(multi.status()).toBe(201);
    const multiBody = await jsonBody<Envelope<MultiRailBody>>(multi);
    expect(multiBody.data.routingEngineVersion).toBe('2.0.0');
    expect(multiBody.data.aiUsed).toBe(false);
    expect(multiBody.data.routes.every((route) => route.executable === false)).toBe(true);

    const highest = [...body.data.routes].sort(
      (left, right) => Number(right.slippageBps) - Number(left.slippageBps),
    )[0];
    const lowest = [...body.data.routes].sort(
      (left, right) => Number(left.slippageBps) - Number(right.slippageBps),
    )[0];
    expect(highest).toBeDefined();
    expect(lowest).toBeDefined();
    if (highest === undefined || lowest === undefined) {
      return;
    }
    expect(Number(highest.slippageBps)).toBeGreaterThanOrEqual(Number(lowest.slippageBps));
    // MultiRail prices slippage into all-in cost. There is no separate slippage score factor.
    expect(highest.scoreComponents.slippage).toBeUndefined();
    expect(lowest.scoreComponents.slippage).toBeUndefined();
    const costliest = [...body.data.routes].sort(
      (left, right) => Number(right.totalCostBps) - Number(left.totalCostBps),
    )[0];
    const cheapest = [...body.data.routes].sort(
      (left, right) => Number(left.totalCostBps) - Number(right.totalCostBps),
    )[0];
    expect(Number(costliest?.scoreComponents.cost)).toBeLessThanOrEqual(
      Number(cheapest?.scoreComponents.cost),
    );
  });

  test('rejects selecting a route after policy PATCH lowers maxSlippageBps', async ({ request }) => {
    const token = await loginDemoOperator(request);
    const minted = await request.post('/api/v1/agents', {
      headers: bearerHeaders(token),
      data: { name: 'E2E slippage agent' },
    });
    expect(minted.status()).toBe(201);
    const issued = await jsonBody<Envelope<IssuedAgentBody>>(minted);
    const secret = issued.data.secret;

    // Solstice's sandbox notional floor is USD 1,000; $500 payments never receive that quote.
    const created = await request.post('/api/v1/payment-intents', {
      headers: agentHeaders({ 'idempotency-key': uniqueIdempotencyKey('slip-create') }, secret),
      data: { instruction: 'Pay 1000 USD to merchant X' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const intent = await jsonBody<Envelope<PaymentIntentBody>>(created);
    const quoted = await request.post(`/api/v1/payment-intents/${intent.data.id}/quote`, {
      headers: agentHeaders({}, secret),
    });
    expect(quoted.status(), await quoted.text()).toBe(200);
    const quotedBody = await jsonBody<Envelope<PaymentIntentBody>>(quoted);
    const rejected = defined(
      [...quotedBody.data.quotedRoutes].sort(
        (left, right) => Number(right.slippageBps ?? '0') - Number(left.slippageBps ?? '0'),
      )[0],
      'highest-slippage quoted route',
    );
    expect(Number(rejected.slippageBps ?? '0')).toBeGreaterThan(1);

    const tightened = await request.patch(`/api/v1/dashboard/agents/${issued.data.id}/policies`, {
      headers: bearerHeaders(token),
      data: { maxSlippageBps: '1' },
    });
    expect(tightened.status()).toBe(200);

    const selected = await request.post(`/api/v1/payment-intents/${intent.data.id}/select`, {
      headers: agentHeaders({}, secret),
      data: { routeId: rejected.routeId },
    });
    const denied = await expectError(selected, 403, 'POLICY_DENIED');
    expect(denied.error.details['rule']).toBe('maximum_slippage');
    expect(denied.error.details['failClosed']).toBe(true);
  });
});

test.describe('Cross-cutting financial routing invariants', () => {
  test('publishes non-custodial capabilities and refuses real execution', async ({ request }) => {
    const meta = await request.get('/api/v1/meta');
    expect(meta.status()).toBe(200);
    const body = await jsonBody<MetaBody>(meta);
    expect(body.data.engineVersion).toBe('2.0.0');
    expect(body.data.routingEngineVersion).toBe('2.0.0');
    expect(body.data.graphEngineVersion).toBe('1.0.0');
    expect(body.data.stablecoinRoutingEngineVersion).toBe('1.0.0');
    expect(body.data.defiRoutingEngineVersion).toBe('1.0.0');
    expect(body.data.capabilities.executeTransactions).toBe(false);
    expect(body.data.capabilities.delegateExecution).toBe(false);
    expect(body.data.capabilities.custodyFunds).toBe(false);
    expect(body.data.capabilities.holdPrivateKeys).toBe(false);
    expect(body.data.capabilities.controlCustomerWallets).toBe(false);
    expect(body.data.capabilities.operateAsPrincipal).toBe(false);
    expect(body.data.capabilities.defiExecution).toBe(false);
    expect(body.data.capabilities.compareRoutes).toBe(true);
    expect(body.data.capabilities.multiRailRouting).toBe(true);
    expect(body.data.capabilities.agentPayments).toBe(true);
    expect(body.data.capabilities.paymentPolicyEngine).toBe(true);
    expect(body.data.capabilities.executionIntents).toBe(true);
    expect(body.data.execution.implemented).toBe(false);
    expect(body.data.execution.statusCode).toBe(501);
    assertNonCustodialText(body);
  });

  test('rejects execute flags and private keys on comparison and routing bodies', async ({
    request,
  }) => {
    const comparison = await request.post('/api/v1/comparisons', {
      data: { ...USD_100K_KRW, execute: true, privateKey: '0xabc' },
    });
    await expectError(comparison, 400, 'VALIDATION_ERROR');

    const routes = await request.post('/api/v1/routes', {
      data: {
        sourceAsset: 'USD',
        destinationAsset: 'KRW',
        amount: '100000.00',
        execute: true,
        privateKey: '0xabc',
      },
    });
    await expectError(routes, 400, 'VALIDATION_ERROR');
  });

  test('requires a credential for quoting and dashboard access', async ({ request }) => {
    const anonymousQuote = await request.post('/api/v1/quote', {
      data: { sourceAsset: 'USD', destinationAsset: 'KRW', amount: '500.00' },
    });
    await expectError(anonymousQuote, 401, 'UNAUTHENTICATED');

    const anonymousDashboard = await request.get('/api/v1/dashboard/agents');
    await expectError(anonymousDashboard, 401, 'UNAUTHENTICATED');

    const badKey = await request.post('/api/v1/payment-intents', {
      headers: { 'x-api-key': 'mag_not_a_real_agent_secret' },
      data: { instruction: 'Pay 500 USD to merchant X' },
    });
    await expectError(badKey, 401, 'UNAUTHENTICATED');
  });

  test('replays identical idempotency keys and conflicts on a mutated payload', async ({
    request,
  }) => {
    const comparisonKey = uniqueIdempotencyKey('cmp-idem');
    const first = await request.post('/api/v1/comparisons', {
      headers: { 'idempotency-key': comparisonKey },
      data: { ...USD_100K_KRW },
    });
    expect(first.status()).toBe(201);
    const firstId = (await jsonBody<ComparisonBody>(first)).data.comparisonId;
    const second = await request.post('/api/v1/comparisons', {
      headers: { 'idempotency-key': comparisonKey },
      data: { ...USD_100K_KRW },
    });
    expect(second.status()).toBe(201);
    expect((await jsonBody<ComparisonBody>(second)).data.comparisonId).toBe(firstId);

    const shortKey = await request.post('/api/v1/comparisons', {
      headers: { 'idempotency-key': 'short' },
      data: { ...USD_100K_KRW },
    });
    await expectError(shortKey, 400, 'VALIDATION_ERROR');

    const paymentKey = uniqueIdempotencyKey('pay-idem');
    const created = await request.post('/api/v1/payment-intents', {
      headers: agentHeaders({ 'idempotency-key': paymentKey }),
      data: { instruction: 'Pay 500 USD to merchant X' },
    });
    expect(created.status()).toBe(201);
    const originalId = (await jsonBody<Envelope<PaymentIntentBody>>(created)).data.id;
    const replay = await request.post('/api/v1/payment-intents', {
      headers: agentHeaders({ 'idempotency-key': paymentKey }),
      data: { instruction: 'Pay 500 USD to merchant X' },
    });
    expect(replay.status()).toBe(201);
    expect((await jsonBody<Envelope<PaymentIntentBody>>(replay)).data.id).toBe(originalId);

    const conflict = await request.post('/api/v1/payment-intents', {
      headers: agentHeaders({ 'idempotency-key': paymentKey }),
      data: { instruction: 'Pay 600 USD to merchant X' },
    });
    await expectError(conflict, 409, 'IDEMPOTENCY_CONFLICT');
  });

  test('never lists another tenant payment or the agent secret', async ({ request }) => {
    const token = await loginDemoOperator(request);
    const agents = await request.get('/api/v1/dashboard/agents', {
      headers: bearerHeaders(token),
    });
    expect(agents.status()).toBe(200);
    const text = await agents.text();
    expect(text).not.toContain('pay_other_secret');
    expect(text).not.toContain('99999900');
    expect(text).not.toContain(DEMO_AGENT_SECRET);
    expect(text).toContain(DEMO_AGENT_ID);

    const listed = await request.get('/api/v1/agents', { headers: bearerHeaders(token) });
    expect(listed.status()).toBe(200);
    const listedText = await listed.text();
    expect(listedText).not.toContain(DEMO_AGENT_SECRET);
    expect(listedText).toContain(DEMO_AGENT_KEY_PREFIX);

    const payments = await request.get(`/api/v1/dashboard/agents/${DEMO_AGENT_ID}/payments`, {
      headers: bearerHeaders(token),
    });
    expect(payments.status()).toBe(200);
    const paymentsText = await payments.text();
    expect(paymentsText).not.toContain('pay_other_secret');
    expect(paymentsText).not.toContain('99999900');
  });

  test('agent credentials cannot patch policy', async ({ request }) => {
    const response = await request.patch(`/api/v1/dashboard/agents/${DEMO_AGENT_ID}/policies`, {
      headers: agentHeaders(),
      data: { maxSlippageBps: '1' },
    });
    await expectError(response, 403, 'FORBIDDEN');
  });
});
