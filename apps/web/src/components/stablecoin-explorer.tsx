'use client';

import { Coins } from 'lucide-react';
import { useState, useTransition, type ReactNode } from 'react';
import { evaluateStablecoinRoutes } from '@/app/actions';
import { QuoteExpiryBadge } from '@/components/quote-expiry';
import { ErrorState, ResultsSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProviderLicensingBadge } from '@/components/provider-licensing-badge';
import type { ApiFailure, StablecoinCatalogDto, StablecoinRouteDto, StablecoinRoutingDto } from '@/lib/api/types';
import { formatAssetAmount, formatBps, formatRate, formatSettlement } from '@/lib/format';

const PRESETS = [
  { id: 'usd-usdc', source: 'USD', dest: 'USDC', amount: '10000.00', label: 'USD → USDC' },
  { id: 'usdc-usd', source: 'USDC', dest: 'USD', amount: '10000', label: 'USDC → USD' },
  { id: 'usdc-usdt', source: 'USDC', dest: 'USDT', amount: '10000', label: 'USDC → USDT' },
  { id: 'usdt-usd', source: 'USDT', dest: 'USD', amount: '10000', label: 'USDT → USD' },
  { id: 'usdc-krw', source: 'USDC', dest: 'KRW', amount: '100000', label: 'USDC → KRW' },
] as const;

type ViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'success'; readonly routing: StablecoinRoutingDto; readonly disclaimer: string }
  | { readonly kind: 'error'; readonly failure: ApiFailure };

export function StablecoinExplorer({ catalog }: { catalog: StablecoinCatalogDto | null }) {
  const [source, setSource] = useState('USD');
  const [dest, setDest] = useState('USDC');
  const [amount, setAmount] = useState('10000.00');
  const [state, setState] = useState<ViewState>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  const submit = (): void => {
    startTransition(async () => {
      const result = await evaluateStablecoinRoutes({
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
        <div className="grid gap-3 sm:grid-cols-2">
          {catalog.stablecoins.map((asset) => (
            <Card key={asset.code}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg">{asset.code}</CardTitle>
                  <Badge variant="secondary">{asset.name}</Badge>
                </div>
                <CardDescription>
                  Pegged to {asset.pegCurrency}. Quoted on {asset.defaultChain.name} (
                  {asset.defaultChain.id}). The chain is named for settlement metadata only — this
                  process does not connect to it.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground space-y-1 text-xs">
                <p>Custody: never. Connected: {asset.defaultChain.connected ? 'yes' : 'no'}.</p>
                <p>
                  Future chains:{' '}
                  {asset.chains
                    .filter((chain) => chain.status === 'planned')
                    .map((chain) => chain.name)
                    .join(', ') || 'none listed'}
                  .
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Quote a stablecoin corridor</CardTitle>
          <CardDescription>
            Fiat → stablecoin, stablecoin → fiat, or stablecoin → stablecoin. Ranked by indicative
            cost. Meridian discovers and compares routes; a licensed partner would settle them.
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
              <Label htmlFor="stable-source">Source asset</Label>
              <Input
                id="stable-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stable-dest">Destination asset</Label>
              <Input
                id="stable-dest"
                value={dest}
                onChange={(event) => setDest(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stable-amount">Amount</Label>
              <Input
                id="stable-amount"
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
      {!isPending && state.kind === 'idle' && <StablecoinIdle />}
      {!isPending && state.kind === 'error' && <ErrorState failure={state.failure} />}
      {state.kind === 'success' && (
        <StablecoinResult routing={state.routing} disclaimer={state.disclaimer} />
      )}
    </div>
  );
}

function StablecoinIdle() {
  return (
    <div className="border-border/60 rounded-xl border border-dashed p-8 text-center">
      <Coins className="text-muted-foreground mx-auto size-8" aria-hidden />
      <h2 className="mt-3 text-base font-semibold">No stablecoin quote yet</h2>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
        Choose a corridor such as USD → USDC or USDC → USDT. Quotes include asset, chain, price,
        provider fee, network fee, slippage, liquidity, settlement time and expiration. Nothing here
        holds the token or opens a wallet.
      </p>
    </div>
  );
}

function StablecoinResult({
  routing,
  disclaimer,
}: {
  routing: StablecoinRoutingDto;
  disclaimer: string;
}) {
  const recommended = routing.recommendedRoute;

  return (
    <div className="space-y-4">
      {recommended !== null && (
        <Card className="border-emerald-600/40">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg">{recommended.provider.name}</CardTitle>
              <Badge>Recommended</Badge>
              <ProviderLicensingBadge licensing={recommended.provider.licensing} />
              <Badge variant="secondary">{recommended.conversionKind.replaceAll('_', ' ')}</Badge>
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
                {route.recommended && <Badge>Recommended</Badge>}
                <ProviderLicensingBadge licensing={route.provider.licensing} />
                <Badge variant="outline">{route.provider.railLabel}</Badge>
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

function QuoteFields({ route }: { route: StablecoinRouteDto }) {
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
      <Field label="Provider fee">{formatAssetAmount(route.providerFee)}</Field>
      <Field label="Network fee">{formatAssetAmount(route.networkFee)}</Field>
      <Field label="Slippage">
        {formatBps(route.slippage.bps)}
        <span className="text-muted-foreground mt-0.5 block text-xs">{route.slippage.model.kind}</span>
      </Field>
      <Field label="Liquidity">
        {route.liquidity.availableDepthMinorUnits === null
          ? 'Not disclosed'
          : `${route.liquidity.availableDepthMinorUnits} minor units`}
        {route.liquidity.venue !== null && (
          <span className="text-muted-foreground mt-0.5 block text-xs">{route.liquidity.venue}</span>
        )}
      </Field>
      <Field label="Estimated settlement">
        {formatSettlement(
          route.estimatedSettlementTime.p50Seconds,
          route.estimatedSettlementTime.businessDaysOnly,
        )}
      </Field>
      <Field label="Expiration">
        {route.expiration === null ? 'No window published' : <QuoteExpiryBadge expiresAt={route.expiration} />}
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
