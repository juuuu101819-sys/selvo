# Meridian — Master Product Definition

Meridian is a **global non-custodial financial routing hub**.

It does not move money. It discovers, quotes, compares, ranks and (later) delegates settlement to
licensed or authorized providers across three rail families. The B2B FX/payment comparison already
in production is the first slice of that hub, not a product to replace.

Canonical identity (also published at `GET /api/v1/meta`):

| Field        | Value |
| ------------ | ----- |
| Kind         | `global_non_custodial_financial_routing_hub` |
| Pipeline     | Discover → Quote → Compare → Route → Optimize → Delegate execution |
| Positioning  | Non-custodial routing. Never custodian, never principal, never key-holder. |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how the code is aligned to this definition, and
[COMPLIANCE.md](./COMPLIANCE.md) for the hard boundaries.

---

## What the platform is for

A caller describes an economic transfer — currencies, amount, optional rail or family filter — and
Meridian returns ranked, comparable routes with all-in cost against a mid-market benchmark.

The long-term job is to be the **financial routing layer for autonomous economic activity**: humans,
businesses and (later) AI agents using the same quote-and-delegate contract.

It is **not** a bank, a broker, an exchange, a custodian, a wallet, a DEX, a money transmitter, or a
principal trading desk.

---

## Three financial rails

Every priced route belongs to exactly one **rail** and every rail belongs to exactly one **family**.
The engine still filters by rail; families are a product map over that existing set.

### 1. Traditional finance (`tradfi`) — available

FX desks, correspondent banks, licensed payment institutions, wholesale liquidity providers, and
(planned) treasury products used to hold or time a currency position.

Current rails: `bank_fx`, `payment_institution`, `liquidity_provider`. Planned: `treasury_product`.

### 2. Stablecoin finance (`stablecoin`) — available

Licensed on-ramp, off-ramp and stablecoin settlement. Fiat ↔ stablecoin and stablecoin ↔
stablecoin conversion is priced as a route through a licensed or catalog partner. Demo assets
today: USDC and USDT. Meridian never holds the asset, does not issue stablecoins, and does not
connect to a chain.

Current rail: `stablecoin_settlement`. Dedicated HTTP: `GET /api/v1/stablecoins`,
`POST /api/v1/stablecoin-routes`.

### 3. DeFi liquidity (`defi`) — quoting available; comparison rail planned

DEX, AMM, DEX aggregators, on-chain liquidity, and later cross-chain liquidity.

Reserved comparison rail: `dex_liquidity` (still `planned` on `POST /comparisons`). A normalised
`DeFiLiquiditySource` plus demo DEX, AMM and aggregator live on the **financial provider catalog**
and on `GET /api/v1/defi-liquidity` / `POST /api/v1/defi-routes`. They are not `RouteProvider`s and
do not appear in `POST /comparisons`. **No adapter submits a swap.** No keys, wallets or custody.
Adding Ethereum, Base, Arbitrum or Solana later is a chain-registry row — the routing engine does
not switch on chain. DeFi *execution* is out of scope.

---

## Core function

```
DISCOVER → QUOTE → COMPARE → ROUTE → OPTIMIZE → DELEGATE EXECUTION
```

| Stage     | Status    | Meaning |
| --------- | --------- | ------- |
| Discover  | available | List corridors, rails, families and providers this deployment will price. |
| Quote     | available | Collect pricing primitives from every eligible provider. |
| Compare   | available | Derive all-in cost against the same mid-market benchmark. |
| Route     | available | Rank candidates and name a recommended route. |
| Optimize  | available | Apply caller scoring weights. |
| Delegate  | planned   | Instruct a licensed partner to settle. Not implemented. |

Delegation is the only stage that would move money, and it is refused until the compliance gate in
[COMPLIANCE.md](./COMPLIANCE.md) is satisfied. Until then `POST /api/v1/executions` is an audited
`501`. The platform never executes as principal.

---

## Non-custodial contract

Meridian must not:

- custody fiat
- custody crypto
- hold customer funds
- hold private keys
- control customer wallets
- operate as principal
- provide investment guarantees
- directly execute regulated financial activity unless properly licensed

Execution and settlement are **delegated** to appropriate external providers. That capability is
declared (`delegateExecution: false`) and not implemented. There is no code path that could initiate
a payment, sign a transaction, or hold a balance.

Quotes are **indicative and non-binding**. Sandbox pricing is synthetic reference data.

---

## Who participates

Three economic actors, distinct from tenancy. An actor always acts *for* an organization; it is
never a holder of funds on this platform.

| Actor       | Today                                      | Later |
| ----------- | ------------------------------------------ | ----- |
| Human       | Session user comparing routes for a firm   | Same  |
| Business    | Organization via dashboard or API key      | Same  |
| AI agent    | Not issued. Reserved on `Principal`        | Quote, compare, select, initiate via an authorized provider |

Interaction models:

| Model                 | Status    |
| --------------------- | --------- |
| Human → Business      | available |
| Business → Business   | available |
| Business → AI Agent   | planned   |
| AI Agent → Business   | planned   |
| AI Agent → AI Agent   | planned   |

Today's product is the first two. Agent payment *execution* is not implemented; agents must not be
able to move money through this platform until delegation exists and is licensed.

---

## Long-term: AI agent payments

AI agents should eventually use the API to:

- request a quote
- compare routes
- select an optimal route
- initiate a payment through an authorized provider
- pay businesses and other AI agents
- receive payments
- convert between fiat and stablecoin rails
- manage treasury

That is a **consumer of the routing hub**, not a second product. The same Discover → Delegate
pipeline, the same non-custodial contract, the same organization tenancy. Do not build a parallel
agent-payments stack.

Not in this phase: agent credentials, agent wallets, agent-to-agent settlement, treasury automation.

---

## What this phase changed, and what it did not

**Changed:** product identity, rail families, pipeline and capability declarations, an economic-actor
field on `Principal`, a read-only DeFi depth port, `railFamilies` on `POST /comparisons`, and the
docs that describe them.

**Not changed:** the quote engine, `ENGINE_VERSION` (`2.0.0`), Prisma schema, sandbox adapters, the
comparison UI, dashboard, or any execution path.

**Not started:** DeFi execution, delegated settlement, AI agent payment execution. The financial
routing API (`POST /api/v1/quote`, `POST /api/v1/routes/search`, hashed organization API keys) is
implemented. `transaction:create` records an execution intent; it does not pay. Read-only DeFi
quotes exist on the financial provider catalog and on the DeFi liquidity routing layer
(`GET /api/v1/defi-liquidity`, `POST /api/v1/defi-routes`). Multi-rail routing (`POST /api/v1/routes`) ranks
those quotes deterministically; it does not execute them. The financial route graph
(`GET /api/v1/route-graph`, `POST /api/v1/route-graph/paths`) discovers multi-hop conversions
without pricing them or submitting them. The stablecoin routing layer
(`GET /api/v1/stablecoins`, `POST /api/v1/stablecoin-routes`) quotes USDC and USDT against fiat
and against each other without holding the token or connecting to a chain.
