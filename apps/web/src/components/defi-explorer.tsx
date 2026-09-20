'use client';

import { Layers } from 'lucide-react';
import { useState, useTransition, type ReactNode } from 'react';
import { evaluateDefiRoutes } from '@/app/actions';
import { QuoteExpiryBadge } from '@/components/quote-expiry';
import { ErrorState, ResultsSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProviderLicensingBadge } from '@/components/provider-licensing-badge';
import type { ApiFailure, DefiCatalogDto, DefiRouteDto, DefiRoutingDto } from '@/lib/api/types';
import { formatAssetAmount, formatBps, formatRate, formatSettlement } from '@/lib/format';

const PRESETS = [
  { id: 'usdc-usdt', source: 'USDC', dest: 'USDT', amount: '10000', label: 'USDC → USDT' },
  { id: 'eth-usdc', source: 'ETH', dest: 'USDC', amount: '1', label: 'ETH → USDC' },
  { id: 'eth-usdt', source: 'ETH', dest: 'USDT', amount: '1', label: 'ETH → USDT' },
  { id: 'usd-krw', source: 'USD', dest: 'KRW', amount: '100000.00', label: 'USD → KRW' },
  { id: 'usd-usdc', source: 'USD', dest: 'USDC', amount: '10000.00', label: 'USD → USDC' },
] as const;

type ViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'success'; readonly routing: DefiRoutingDto; readonly disclaimer: string }
  | { readonly kind: 'error'; readonly failure: ApiFailure };

export function DefiExplorer({ catalog }: { catalog: DefiCatalogDto | null }) {
  const [source, setSource] = useState('USDC');
  const [dest, setDest] = useState('USDT');
  const [amount, setAmount] = useState('10000');
  const [state, setState] = useState<ViewState>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  const submit = (): void => {
    startTransition(async () => {
      const result = await evaluateDefiRoutes({
        sourceAsset: source.trim().toUpperCase(),
        destinationAsset: dest.trim().toUpperCase(),
        amount: amount.trim(),
      });
      setState(
        result.ok
          ? { kind: 'success', routing: result.data, disclaimer: result.disclaimer }
          : { kind: 'error', failure: result.failure },
      );
    });
  };

  return (
    <div className="space-y-6">
      {catalog !== null && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {catalog.pools.map((pool) => (
              <Card key={pool.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-lg">{pool.id}</CardTitle>
                    <Badge variant="secondary">{pool.status}</Badge>
                  </div>
                  <CardDescription>
                    Demo pool on {pool.defaultChain.name} ({pool.defaultChain.id}). The chain is
                    named for settlement metadata only — this process does not connect to it.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-muted-foreground text-xs">
                  Custody: never. Platform inventory: none.
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {catalog.venues.map((venue) => (
              <Card key={venue.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-lg">{venue.name}</CardTitle>
                    <Badge variant="outline">{venue.venueKind}</Badge>
                  </div>
                  <CardDescription>
                    Tokens: {venue.tokens.join(', ')}. Chains stay disconnected; RPC is never
                    opened.
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Reserved chains</CardTitle>
              <CardDescription>
                Adding Ethereum, Base, Arbitrum or Solana to a later adapter is a registry row — the
                routing engine does not switch on chain name.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-2">
                {catalog.chains.map((chain) => (
                  <li key={chain.id}>
                    <Badge variant={chain.quoting === 'available' ? 'secondary' : 'outline'}>
                      {chain.name}
                      {chain.quoting === 'planned' ? ' · planned' : ''} · not connected
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Quote a DeFi corridor</CardTitle>
          <CardDescription>
            DEX, AMM and aggregator venues on the demo pools, ranked against a stablecoin ramp or
            traditional FX desk when one can price the same pair. Meridian never submits a swap,
            connects a wallet, or holds a key.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant={source === preset.source && dest === preset.dest ? 'default' : 'outline'}
                onClick={() => {
                  setSource(preset.source);
                  setDest(preset.dest);
                  setAmount(preset.amount);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <form
            className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="defi-source">Source asset</Label>
              <Input
                id="defi-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defi-dest">Destination asset</Label>
              <Input
                id="defi-dest"
                value={dest}
                onChange={(event) => setDest(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defi-amount">Amount</Label>
              <Input
                id="defi-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Quoting…' : 'Quote routes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isPending && state.kind !== 'success' && <ResultsSkeleton />}
      {!isPending && state.kind === 'idle' && <DefiIdle />}
      {!isPending && state.kind === 'error' && <ErrorState failure={state.failure} />}
      {state.kind === 'success' && (
        <DefiResult routing={state.routing} disclaimer={state.disclaimer} />
      )}
    </div>
  );
}

function DefiIdle() {
  return (
    <div className="border-border/60 rounded-xl border border-dashed p-8 text-center">
      <Layers className="text-muted-foreground mx-auto size-8" aria-hidden />
      <h2 className="mt-3 text-base font-semibold">No DeFi quote yet</h2>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
        Quote USDC → USDT on the demo DEX, AMM and aggregator, or ETH against a stablecoin. USD →
        KRW compares traditional FX with a stablecoin ramp. Nothing here holds inventory, opens a
        wallet, or submits a swap.
      </p>
    </div>
  );
}

function DefiResult({ routing, disclaimer }: { routing: DefiRoutingDto; disclaimer: string }) {
  const recommended = routing.recommendedExecutionRoute ?? routing.recommendedRoute;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Compared families:{' '}
        <span className="text-foreground font-medium">
          {routing.comparedFamilies.join(', ') || 'none'}
        </span>
        . Recommended execution route is a quote rank, not a submitted swap.
      </p>

      {recommended !== null && (
        <Card className="border-recommend/40">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg">{recommended.provider.name}</CardTitle>
              <Badge variant="recommend">Recommended execution route</Badge>
              <ProviderLicensingBadge licensing={recommended.provider.licensing} />
              <Badge variant="secondary">{recommended.routeKind}</Badge>
            </div>
            <CardDescription>{recommended.explanation}</CardDescription>
          </CardHeader>
          <CardContent>
            <QuoteFields route={recommended} />
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {routing.routes.map((route) => (
          <Card key={route.routeId}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{route.provider.name}</CardTitle>
                {route.recommended && <Badge variant="recommend">Recommended</Badge>}
                <ProviderLicensingBadge licensing={route.provider.licensing} />
                <Badge variant="outline">{route.routeKind}</Badge>
                {route.venueKind !== null && <Badge variant="secondary">{route.venueKind}</Badge>}
                <span className="text-muted-foreground font-mono text-xs">
                  {formatBps(route.totalCostBps)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <QuoteFields route={route} />
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">{disclaimer}</p>
      <p className="text-muted-foreground text-xs">{routing.explanation}</p>
    </div>
  );
}

function QuoteFields({ route }: { route: DefiRouteDto }) {
  const chain = route.chain.settlement ?? route.chain.destination ?? route.chain.source;

  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Asset">
        {route.asset.source} → {route.asset.destination}
      </Field>
      <Field label="Chain">
        {chain === null
          ? 'Fiat — no chain'
          : `${chain.name} (${chain.id}), ${chain.connected ? 'connected' : 'not connected'}`}
      </Field>
      <Field label="Price">
        {formatRate(route.price.indicated)} {route.asset.destination} / 1 {route.asset.source}
        <span className="text-muted-foreground mt-0.5 block text-xs">
          mid {formatRate(route.price.mid)}
        </span>
      </Field>
      <Field label="Swap fee">{formatAssetAmount(route.swapFee)}</Field>
      <Field label="Network fee">{formatAssetAmount(route.networkFee)}</Field>
      <Field label="Estimated slippage">
        {formatBps(route.estimatedSlippage.bps)}
        <span className="text-muted-foreground mt-0.5 block text-xs">
          {route.estimatedSlippage.model.kind}
        </span>
      </Field>
      <Field label="Liquidity">
        {route.liquidity.availableDepthMinorUnits === null
          ? 'Not disclosed'
          : `${route.liquidity.availableDepthMinorUnits} minor units`}
        {route.liquidity.venue !== null && (
          <span className="text-muted-foreground mt-0.5 block text-xs">
            {route.liquidity.venue}
          </span>
        )}
      </Field>
      <Field label="Estimated settlement">
        {formatSettlement(
          route.estimatedSettlementTime.p50Seconds,
          route.estimatedSettlementTime.businessDaysOnly,
        )}
      </Field>
      <Field label="Expiration">
        {route.expiration === null ? (
          'No window published'
        ) : (
          <QuoteExpiryBadge expiresAt={route.expiration} />
        )}
      </Field>
      <Field label="Receive">{formatAssetAmount(route.estimatedReceiveAmount)}</Field>
    </dl>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
