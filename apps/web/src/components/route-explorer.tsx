'use client';

import { useState, useTransition } from 'react';
import { evaluateRoutes } from '@/app/actions';
import { EmptyState, ErrorState, ResultsSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProviderLicensingBadge } from '@/components/provider-licensing-badge';
import type { ApiFailure, MultiRailRoutingDto } from '@/lib/api/types';
import { formatAssetAmount, formatBps, formatSettlement } from '@/lib/format';

const CORRIDORS = [
  { id: 'usd-krw', source: 'USD', dest: 'KRW', amount: '100000.00', label: 'USD → KRW' },
  { id: 'usd-eur', source: 'USD', dest: 'EUR', amount: '100000.00', label: 'USD → EUR' },
  { id: 'usd-usdc', source: 'USD', dest: 'USDC', amount: '10000.00', label: 'USD → USDC' },
  { id: 'usdc-krw', source: 'USDC', dest: 'KRW', amount: '100000', label: 'USDC → KRW' },
  { id: 'usdc-usdt', source: 'USDC', dest: 'USDT', amount: '10000', label: 'USDC → USDT' },
] as const;

type ViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'success'; readonly routing: MultiRailRoutingDto; readonly disclaimer: string }
  | { readonly kind: 'error'; readonly failure: ApiFailure };

export function RouteExplorer() {
  const [source, setSource] = useState('USD');
  const [dest, setDest] = useState('KRW');
  const [amount, setAmount] = useState('100000.00');
  const [state, setState] = useState<ViewState>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  const submit = (): void => {
    startTransition(async () => {
      const result = await evaluateRoutes({
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
      <Card>
        <CardHeader>
          <CardTitle>Evaluate every rail</CardTitle>
          <CardDescription>
            Traditional finance, stablecoin ramps and read-only DeFi quotes are scored with the same
            deterministic weights. No rail is assumed cheaper. No model prices a route.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {CORRIDORS.map((corridor) => (
              <Button
                key={corridor.id}
                type="button"
                size="sm"
                variant={source === corridor.source && dest === corridor.dest ? 'default' : 'outline'}
                onClick={() => {
                  setSource(corridor.source);
                  setDest(corridor.dest);
                  setAmount(corridor.amount);
                }}
              >
                {corridor.label}
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
              <Label htmlFor="sourceAsset">Source asset</Label>
              <Input
                id="sourceAsset"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="destinationAsset">Destination asset</Label>
              <Input
                id="destinationAsset"
                value={dest}
                onChange={(event) => setDest(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="route-amount">Amount</Label>
              <Input
                id="route-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Scoring…' : 'Score routes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isPending && state.kind !== 'success' && <ResultsSkeleton />}
      {!isPending && state.kind === 'idle' && <EmptyState />}
      {!isPending && state.kind === 'error' && <ErrorState failure={state.failure} />}
      {state.kind === 'success' && (
        <RoutingResult routing={state.routing} disclaimer={state.disclaimer} />
      )}
    </div>
  );
}

function RoutingResult({
  routing,
  disclaimer,
}: {
  routing: MultiRailRoutingDto;
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
              <Badge variant="secondary">{recommended.provider.railFamily}</Badge>
              <span className="font-mono text-sm">score {recommended.routeScore}</span>
            </div>
            <CardDescription>{recommended.hops.join(' → ')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">You receive</dt>
                <dd className="font-medium">
                  {formatAssetAmount(recommended.estimatedReceiveAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">All-in cost</dt>
                <dd className="font-medium">
                  {formatAssetAmount(recommended.estimatedCost)} (
                  {formatBps(recommended.totalCostBps)})
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Settlement</dt>
                <dd className="font-medium">
                  {formatSettlement(
                    recommended.estimatedSettlementTime.p50Seconds,
                    recommended.estimatedSettlementTime.businessDaysOnly,
                  )}
                </dd>
              </div>
            </dl>
            <ScoreBar components={recommended.scoreComponents} />
            <p className="text-muted-foreground leading-relaxed">{routing.routeExplanation}</p>
          </CardContent>
        </Card>
      )}

      <ul className="space-y-3">
        {routing.routes.map((route) => (
          <li key={route.routeId}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    {route.rank}. {route.provider.name}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <ProviderLicensingBadge licensing={route.provider.licensing} />
                    <Badge variant="secondary">{route.provider.category}</Badge>
                    <span className="font-mono text-xs">score {route.routeScore}</span>
                  </div>
                </div>
                <CardDescription>{route.hops.join(' → ')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  Receive {formatAssetAmount(route.estimatedReceiveAmount)} · cost{' '}
                  {formatBps(route.totalCostBps)} ·{' '}
                  {formatSettlement(
                    route.estimatedSettlementTime.p50Seconds,
                    route.estimatedSettlementTime.businessDaysOnly,
                  )}
                </p>
                <p className="text-muted-foreground">
                  Provider {formatAssetAmount(route.breakdown.providerFee)} · platform{' '}
                  {formatAssetAmount(route.breakdown.platformFee)} · network{' '}
                  {formatAssetAmount(route.breakdown.networkFee)} · gas{' '}
                  {formatAssetAmount(route.breakdown.gasFee)}
                </p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {routing.plannedRoutes.length > 0 && (
        <p className="text-muted-foreground text-xs">{routing.plannedRoutes[0]?.explanation}</p>
      )}
      <p className="text-muted-foreground text-xs">{disclaimer}</p>
    </div>
  );
}

function ScoreBar({
  components,
}: {
  components: MultiRailRoutingDto['routes'][number]['scoreComponents'];
}) {
  const entries = [
    ['Cost', components.cost],
    ['Speed', components.speed],
    ['Liquidity', components.liquidity],
    ['Reliability', components.reliability],
    ['Confidence', components.settlementConfidence],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted-foreground text-xs">{label}</dt>
          <dd className="font-mono text-xs">{Number(value).toFixed(2)}</dd>
        </div>
      ))}
    </dl>
  );
}
