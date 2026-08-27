'use client';

import { GitBranch, Route } from 'lucide-react';
import { useState, useTransition } from 'react';
import { discoverGraphRoutes } from '@/app/actions';
import { ErrorState, ResultsSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ApiFailure, GraphPathDto, GraphSearchDto, RouteGraphDto } from '@/lib/api/types';
import { formatBps } from '@/lib/format';

const PRESETS = [
  { id: 'one', source: 'USD', dest: 'KRW', hops: 1, cost: '', liq: '', label: 'One hop · USD → KRW' },
  { id: 'two', source: 'USD', dest: 'KRW', hops: 2, cost: '', liq: '', label: 'Two hops · via USDC' },
  { id: 'three', source: 'USD', dest: 'KRW', hops: 3, cost: '', liq: '', label: 'Three hops · USDC → USDT' },
  { id: 'usdc-usdt', source: 'USDC', dest: 'USDT', hops: 1, cost: '', liq: '', label: 'USDC → USDT' },
  { id: 'tight-cost', source: 'USD', dest: 'KRW', hops: 1, cost: '1', liq: '', label: 'Cost cap 1 bps' },
] as const;

type ViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'success'; readonly search: GraphSearchDto; readonly disclaimer: string }
  | { readonly kind: 'error'; readonly failure: ApiFailure };

export function GraphExplorer({ graph }: { graph: RouteGraphDto | null }) {
  const [source, setSource] = useState('USD');
  const [dest, setDest] = useState('KRW');
  const [maxHops, setMaxHops] = useState('3');
  const [maxCost, setMaxCost] = useState('');
  const [minLiquidity, setMinLiquidity] = useState('');
  const [state, setState] = useState<ViewState>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  const submit = (): void => {
    startTransition(async () => {
      const hops = Number.parseInt(maxHops, 10);
      const result = await discoverGraphRoutes({
        sourceAsset: source.trim().toUpperCase(),
        destinationAsset: dest.trim().toUpperCase(),
        maxHops: Number.isInteger(hops) ? hops : 4,
        maxExpectedCostBps: maxCost,
        minLiquidity,
      });
      setState(
        result.ok
          ? { kind: 'success', search: result.data, disclaimer: result.disclaimer }
          : { kind: 'error', failure: result.failure },
      );
    });
  };

  return (
    <div className="space-y-6">
      {graph !== null && (
        <p className="text-muted-foreground text-sm">
          {graph.nodeCount} nodes · {graph.edgeCount} conversion edges · graph engine{' '}
          {graph.graphEngineVersion}. Edges are indicative and never executable.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Discover conversion paths</CardTitle>
          <CardDescription>
            Walk the asset–venue graph under hop, cost, liquidity, availability and compliance
            constraints. This is path discovery, not a live quote.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant={
                  source === preset.source &&
                  dest === preset.dest &&
                  maxHops === String(preset.hops) &&
                  maxCost === preset.cost
                    ? 'default'
                    : 'outline'
                }
                onClick={() => {
                  setSource(preset.source);
                  setDest(preset.dest);
                  setMaxHops(String(preset.hops));
                  setMaxCost(preset.cost);
                  setMinLiquidity(preset.liq);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <form
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="graph-source">Source</Label>
              <Input
                id="graph-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="graph-dest">Destination</Label>
              <Input
                id="graph-dest"
                value={dest}
                onChange={(event) => setDest(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="graph-hops">Max hops</Label>
              <Input
                id="graph-hops"
                value={maxHops}
                onChange={(event) => setMaxHops(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="graph-cost">Max cost (bps)</Label>
              <Input
                id="graph-cost"
                value={maxCost}
                onChange={(event) => setMaxCost(event.target.value)}
                placeholder="unbounded"
                inputMode="decimal"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="graph-liq">Min liquidity</Label>
              <Input
                id="graph-liq"
                value={minLiquidity}
                onChange={(event) => setMinLiquidity(event.target.value)}
                placeholder="none"
                inputMode="decimal"
                autoComplete="off"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? 'Searching…' : 'Find paths'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isPending && state.kind !== 'success' && <ResultsSkeleton />}
      {!isPending && state.kind === 'idle' && <GraphEmptyState />}
      {!isPending && state.kind === 'error' && <ErrorState failure={state.failure} />}
      {state.kind === 'success' && (
        <GraphResult search={state.search} disclaimer={state.disclaimer} />
      )}
    </div>
  );
}

function GraphEmptyState() {
  return (
    <div className="border-border/60 rounded-xl border border-dashed p-8 text-center">
      <GitBranch className="text-muted-foreground mx-auto size-8" aria-hidden />
      <h2 className="mt-3 text-base font-semibold">No path search yet</h2>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
        Choose a corridor and a hop limit to walk USD → FX → KRW, USD → USDC → KRW, or
        USD → USDC → USDT → KRW. Unavailable, expensive and illiquid edges are pruned.
      </p>
    </div>
  );
}

function GraphResult({
  search,
  disclaimer,
}: {
  search: GraphSearchDto;
  disclaimer: string;
}) {
  if (search.paths.length === 0) {
    return (
      <div className="space-y-3">
        <div className="border-border/60 rounded-xl border border-dashed p-8 text-center">
          <Route className="text-muted-foreground mx-auto size-8" aria-hidden />
          <h2 className="mt-3 text-base font-semibold">No valid path</h2>
          <p className="text-muted-foreground mx-auto mt-1 max-w-lg text-sm">{search.explanation}</p>
        </div>
        {search.rejections.length > 0 && (
          <ul className="text-muted-foreground space-y-1 text-xs">
            {search.rejections.slice(0, 8).map((rejection) => (
              <li key={`${rejection.reason}-${rejection.detail}`}>
                {rejection.reason}: {rejection.detail}
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-xs">{disclaimer}</p>
      </div>
    );
  }

  const groups = groupByAssetWalk(search.paths);

  return (
    <div className="space-y-4">
      <p className="text-sm">{search.explanation}</p>
      <p className="text-muted-foreground text-xs">
        {String(search.paths.length)} walks collapsed into {String(groups.length)} distinct asset
        sequences. The cheapest walk in each sequence is shown.
      </p>
      <ul className="space-y-3">
        {groups.map((group) => (
          <li key={group.key}>
            <PathCard path={group.best} variantCount={group.count} />
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">{disclaimer}</p>
    </div>
  );
}

function groupByAssetWalk(
  paths: readonly GraphPathDto[],
): readonly { readonly key: string; readonly best: GraphPathDto; readonly count: number }[] {
  const grouped = new Map<string, GraphPathDto[]>();
  for (const path of paths) {
    const key = path.assets.join('→');
    const list = grouped.get(key) ?? [];
    list.push(path);
    grouped.set(key, list);
  }
  return [...grouped.entries()].map(([key, list]) => {
    const best = list[0];
    if (best === undefined) {
      throw new Error(`Empty path group for ${key}`);
    }
    return { key, best, count: list.length };
  });
}

function PathCard({ path, variantCount }: { path: GraphPathDto; variantCount: number }) {
  return (
    <Card className={path.recommended ? 'border-emerald-600/40' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {path.rank}. {path.hops}-hop · {path.assets.join(' → ')}
          </CardTitle>
          <div className="flex items-center gap-2">
            {path.recommended && <Badge>Recommended</Badge>}
            {variantCount > 1 && (
              <Badge variant="secondary">{String(variantCount)} venue variants</Badge>
            )}
            <span className="font-mono text-xs">{formatBps(path.totalCostBps)}</span>
          </div>
        </div>
        <CardDescription>{path.explanation}</CardDescription>
      </CardHeader>
      <CardContent>
        <HopWalk nodes={path.nodes} />
      </CardContent>
    </Card>
  );
}

function HopWalk({ nodes }: { nodes: GraphPathDto['nodes'] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {nodes.map((node, index) => (
        <li key={`${node.id}-${String(index)}`} className="flex items-center gap-2">
          {index > 0 && (
            <span className="text-muted-foreground" aria-hidden>
              →
            </span>
          )}
          <Badge variant={node.asset !== null ? 'default' : 'outline'} className="font-mono">
            {node.asset ?? node.label}
          </Badge>
          {node.asset === null && (
            <span className="text-muted-foreground hidden text-[11px] sm:inline">{node.kind}</span>
          )}
        </li>
      ))}
    </ol>
  );
}
