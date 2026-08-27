# Meridian — Market Data and Provider Architecture

How the platform talks to the outside world for prices, and why no part of it reaches the routing
engine.

---

## The shape of it

```
                    ┌─────────────────────────────────────────┐
                    │            ProviderAdapter              │
                    │  descriptor · capability · probe?       │
                    └─────────────────────────────────────────┘
                        ▲        ▲        ▲        ▲       ▲
        ┌───────────────┘        │        │        │       └──────────────┐
        │                        │        │        │                      │
 MarketDataProvider       FXProvider  PaymentProvider  LiquidityProvider  RouteProvider
 getMarketRate()          getFXQuote()  getPaymentQuote()  getLiquidityQuote()  fetchQuote()
 DexLiquidityProvider (demo AMM, catalog only) — getDepth() / getQuote(); no swap, no keys
        │                        │        │        │                      ▲
        │                        │        │        │                      ▲
        │                        │        │        │                      │
        └────────► bridge (FXRouteProvider, …) ────┴──────────────────────┘
                                   │
                                   ▼
                          RouteCostEngine  ← knows only RouteProvider
```

Two families of contract, meeting at a bridge:

- **Integration-facing** — `MarketDataProvider`, `FXProvider`, `PaymentProvider`,
  `LiquidityProvider`, and `DexLiquidityProvider`. Shaped like the upstream APIs they wrap, so an
  adapter is a thin translation rather than a reinterpretation.
- **Catalog-facing** — `FinancialProvider`. The common façade: `getQuote`, `getCapabilities`,
  `getSupportedAssets`, `getSupportedCurrencies`, `getSettlementEstimate`, `getFees`,
  `getLiquidityInfo`. Existing route adapters are wrapped; demo ramp / DEX / AMM / aggregator implement it
  directly. A normalised quote can represent fiat, stablecoin and crypto pairs. `executable` is
  always false. DeFi venues also implement `DeFiLiquiditySource` (`getQuote`, `getLiquidity`,
  `getSwapFee`, `getEstimatedSlippage`, `getNetworkFee`, `getSupportedTokens`, `getSupportedChains`).
- **Engine-facing** — `RouteProvider`. Unchanged. The comparison engine still only sees ISO currency
  corridors. DeFi demos are not registered as `RouteProvider`s.
- **Engine-facing** — `RouteProvider`. Expressed in the engine's own vocabulary: a mid-market
  benchmark, an offered rate, a fee schedule, a settlement estimate, a slippage model.

All of them satisfy one common base, `ProviderAdapter`, which is what lets a single resilience
pipeline, a single recorder and a single registry serve every kind of provider.

## Why providers are split by capability

They are not interchangeable in _what they do_. A market data feed says what the market is; an FX
desk says what it will deal at; a payment institution prices a payout rail whose local charges often
dominate the cost on an emerging-market corridor; a wholesale venue prices depth, where the answer
depends on the size asked for. Forcing those into one interface would mean either the widest possible
union of fields — most of them null most of the time — or losing the distinctions that matter.

They _are_ interchangeable in how the platform talks to them: identify yourself, say what you can
price, return a timestamped quote with an expiry. That is `ProviderAdapter`, and it is deliberately
thin.

The most important split is market data from FX. A provider that supplied both its own rate and its
own idea of mid-market could make any spread look like zero. Keeping the benchmark independent is
what makes a cost figure mean anything.

## Nothing provider-specific reaches the engine

The engine consumes exactly one contract. Anything peculiar to an upstream — that it prices in the
spread rather than charging a fee, that it publishes bid and ask instead of a mid, that its fees land
on the destination leg, that it quotes firm rather than with slippage — is resolved in the bridge, on
the far side of `RouteProvider`.

`FXRouteProvider` is the reference implementation. It:

- asks the FX provider for a price, and an independent `MarketDataProvider` for the benchmark;
- maps provider charges onto the engine's fee model, treating a basis-point charge as _proportional_
  so the engine applies it to the actual notional rather than trusting a precomputed amount;
- reports `slippage: none`, because an FX desk quotes firm — a liquidity-venue bridge supplies a
  slippage model instead, and that difference belongs in the bridge;
- **fails** if no benchmark can be established. Substituting the offered rate would report every
  route as costing nothing, which is the most dangerous wrong answer this system could give.

A test proves the point by not needing anything: the engine ranks a bridged FX provider alongside the
dataset rails with no engine code changed.

## Resilience

One pipeline, `executeProviderCall`, wraps every provider call. It exists once rather than in each
adapter, because duplicating it is how one integration ends up quietly missing a timeout — the
failure that turns "one route missing" into "the whole request hangs".

The ordering is deliberate:

1. **Overall budget** is checked before each attempt. Per-attempt timeouts multiply — three attempts
   at four seconds is twelve seconds of waiting — so without a budget one slow provider sets the
   latency of the entire comparison. The final attempt is clamped to whatever budget remains.
2. **Per-attempt timeout**, which aborts the attempt through an `AbortSignal` so an adapter can stop
   work rather than leaking a socket.
3. **Retry**, bounded, with exponential backoff, capped, and jittered. Without jitter every caller
   that failed at the same moment retries at the same moment, and a provider recovering from a blip
   is knocked over again by the synchronised herd.
4. **Recording** of every attempt, success or failure, before the error propagates.

### What gets retried

Only transport-shaped failures. A timeout or an upstream error may well succeed on a second ask; a
rejected currency, a malformed quote or a stale feed returns exactly the same answer, so retrying
wastes the caller's latency budget and loads a provider that has already said something definite.

| Failure                                                              | Retried | Why                                            |
| -------------------------------------------------------------------- | ------- | ---------------------------------------------- |
| `PROVIDER_TIMEOUT`, `PROVIDER_ERROR`                                 | yes     | Transient by nature.                           |
| `QUOTE_EXPIRED`                                                      | yes     | Asking again yields a fresh price.             |
| `QUOTE_STALE`                                                        | **no**  | A lagging feed returns the same lagging price. |
| `UNSUPPORTED_CURRENCY`, `VALIDATION_ERROR`, `INVALID_PROVIDER_QUOTE` | no      | Definite answers.                              |
| An unrecognised throw                                                | yes     | Usually a socket reset or a DNS failure.       |

`QUOTE_EXPIRED` being retryable while `QUOTE_STALE` is not looks inconsistent and is the whole point:
the remedies differ.

`random` and `sleep` are injected rather than taken from `Math.random` and `setTimeout`, so the
backoff schedule is assertable and the suite does not wait out real delays. An un-injectable source
of randomness in the retry path would make failure behaviour untestable.

## Stale quotes and expiry

Two different problems, deliberately distinguished:

- **Expired** — the provider's own `expiresAt` has passed. The provider has withdrawn its price.
- **Stale** — the quote is older than the platform is willing to trust, regardless of the provider's
  TTL. A provider stamping a ten-minute TTL on an FX price is making a commercial statement about its
  own risk appetite, not a statement about how long the market stays still. Holding a separate,
  usually shorter, bound is what stops a comparison being assembled from prices the market has
  already moved past.

Also handled: **clock skew**. A provider clock a few seconds ahead of ours is normal and not grounds
for rejection; a timestamp minutes in the future means something is genuinely wrong. Skew is checked
first, because if the timestamps cannot be trusted then neither age nor expiry means anything.

And an **expiry guard**: a price with 200ms left is not usable by the time it has been ranked and
rendered, so it is counted as expired rather than shown to a customer who cannot act on it.

`assessQuoteFreshness` returns a verdict so a caller can degrade — dropping one stale route from a
comparison rather than failing the request — while `assertQuoteUsable` throws for callers that need a
usable price. The resilience decorators check freshness _after_ recording, so a quote that arrived
but was unusable is still evidenced.

## Every quote is recorded

`QuoteRecorder` receives one entry per attempt, with `requestedAt`, `receivedAt`, the derived
latency, the attempt count, the request, the quote or the error, and a correlation id.

Beyond ordinary observability, two reasons this matters here: a disputed price has to be traceable to
the exact response that produced it, and a provider's reliability score is only honest if failures
are counted as diligently as successes.

`InMemoryQuoteRecorder` is bounded on purpose — an unbounded in-memory log is a slow leak, not an
audit trail. It is the default so nothing silently runs with recording switched off; the durable
record belongs in the `quotes` table.

Records project the quote explicitly rather than spreading the whole object: provider metadata can
carry anything, and a record is not the place to discover that an upstream payload contained
something it should not have.

## The demo providers

**`DemoMarketDataProvider`** reads the versioned reference snapshot and stamps each observation with
its provenance — which dataset, as of when, valid until when. It derives an indicative bid and ask
around the mid so consumers of two-sided prices are exercised in demo mode rather than only in
production. It is not a market feed and every observation says so.

**`DemoFXProvider`** prices by taking a benchmark from an injected `MarketDataProvider` and applying
its own spread and fees. That composition is the design: the provider does not own a view of the
market, so its price can always be measured against something independent. Its quote carries a rate,
a charge, a timestamp and an expiry — and deliberately no total cost, ranking or recommendation.

Both are deterministic: the same corridor, size and dataset always produce the same rate and the same
quote reference, which makes a demo diffable and a regression fixture stable.

`createDemoMarketDataStack()` assembles the intended order — benchmark, then price, then resilience,
then bridge — in one place, rather than leaving each caller to rediscover it and get it subtly wrong.

## Testing

| Suite                               | Covers                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `quote-freshness.test.ts`           | Fresh, stale, expired, the expiry guard, clock skew, precedence between them.                                                               |
| `resilience.test.ts`                | Timeout, abort propagation, retry counts, backoff schedule and cap, jitter, the overall budget, classification, recording of every attempt. |
| `demo-fx-provider.test.ts`          | USD→KRW, USD→EUR and EUR→JPY across valid quote, expired quote, invalid currency, provider failure and timeout.                             |
| `demo-market-data-provider.test.ts` | Rates, TTL, provenance, two-sided prices, cross-rate consistency, invalid input.                                                            |
| `financial-catalog.test.ts`         | Wrapped rails, Helios Ramp, Meridian Pool, Horizon Aggregator, conversion kinds, `executable: false`. |

The corridors are covered as a table so all three get every scenario, rather than one corridor
getting thorough treatment and the others a smoke test.

## Not connected to money movement

Nothing here initiates a payment. These are read-only pricing integrations against a static dataset;
there is no outbound payment-initiation call anywhere in the repository, and
`POST /api/v1/executions` remains an audited `501`. Delegated execution is declared and false.
`POST /api/v1/provider-quotes` returns `executable: false` and rejects `execute` / key fields. See
[COMPLIANCE.md](./COMPLIANCE.md).

## What comes next

The four dataset rails still implement `RouteProvider` directly rather than being expressed as
`FXProvider`, `PaymentProvider` and `LiquidityProvider` behind bridges. Re-expressing them is
mechanical but touches the pricing path, so it belongs in its own change rather than being bundled
with the introduction of the interfaces. `PaymentProvider` and `LiquidityProvider` have contracts and
no implementations yet for the same reason: a bridge with no provider behind it would be speculative.
Reading provider capability from the `providers` and `provider_capabilities` tables, and persisting
quotes through the `quotes` table, are the other outstanding pieces.
