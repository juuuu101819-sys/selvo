'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { quoteFinancialRoute, searchFinancialRoutes } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  AssetCatalogEntryDto,
  CurrencyCatalogEntryDto,
  FinancialQuoteDto,
  RouteSearchDto,
} from '@/lib/api/types';
import { formatAssetAmount } from '@/lib/format';

export function RoutingApiExplorer({
  assets,
  currencies,
  signedIn,
}: {
  assets: readonly AssetCatalogEntryDto[];
  currencies: readonly CurrencyCatalogEntryDto[];
  signedIn: boolean;
}) {
  const [sourceAsset, setSourceAsset] = useState('USD');
  const [destinationAsset, setDestinationAsset] = useState('KRW');
  const [amount, setAmount] = useState('100000.00');
  const [quote, setQuote] = useState<FinancialQuoteDto | null>(null);
  const [search, setSearch] = useState<RouteSearchDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const assetOptions = useMemo(
    () => [...assets].sort((left, right) => left.code.localeCompare(right.code, 'en')),
    [assets],
  );

  async function onQuote(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await quoteFinancialRoute({ sourceAsset, destinationAsset, amount });
    setPending(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    setQuote(result.data);
  }

  async function onSearch() {
    setPending(true);
    setError(null);
    const result = await searchFinancialRoutes({ sourceAsset, destinationAsset });
    setPending(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    setSearch(result.data);
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="border-border rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Assets</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Public catalog from <code>GET /api/v1/assets</code>.
          </p>
          <ul className="mt-3 max-h-56 space-y-1 overflow-auto font-mono text-xs">
            {assetOptions.map((asset) => (
              <li key={asset.code}>
                {asset.code} · {asset.kind} · {asset.decimals} dp
              </li>
            ))}
          </ul>
        </div>
        <div className="border-border rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Currencies</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            ISO 4217 from <code>GET /api/v1/currencies</code>.
          </p>
          <ul className="mt-3 max-h-56 space-y-1 overflow-auto font-mono text-xs">
            {currencies.map((currency) => (
              <li key={currency.code}>
                {currency.code} · {currency.decimals} dp · {currency.name}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <form onSubmit={onQuote} className="border-border space-y-4 rounded-xl border p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-semibold">Quote a route</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            <code>POST /api/v1/quote</code> requires a session or an organization API key with
            quote:read. Quotes expire. They are never executable.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="source-asset">Source</Label>
            <Input
              id="source-asset"
              value={sourceAsset}
              onChange={(event) => setSourceAsset(event.target.value.toUpperCase())}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="destination-asset">Destination</Label>
            <Input
              id="destination-asset"
              value={destinationAsset}
              onChange={(event) => setDestinationAsset(event.target.value.toUpperCase())}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </div>
        </div>
        {error !== null && <p className="text-destructive text-sm">{error}</p>}
        {!signedIn && (
          <p className="text-muted-foreground text-sm">
            Sign in, or send <code>X-Api-Key</code> from your own client. Catalog reads stay public.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={pending || !signedIn}>
            Get quote
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || !signedIn}
            onClick={() => {
              void onSearch();
            }}
          >
            Search paths
          </Button>
        </div>
      </form>

      {quote !== null && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Quote</h2>
          <p className="text-muted-foreground font-mono text-xs">
            expires {quote.quoteExpiresAt ?? '—'} · {quote.routes.length} routes
          </p>
          <ul className="space-y-2">
            {quote.routes.map((route) => (
              <li key={route.routeId} className="border-border rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {route.rank}. {route.provider.name}
                  {route.recommended ? ' · recommended' : ''}
                </p>
                <p className="text-muted-foreground font-mono text-xs">
                  receive {formatAssetAmount(route.estimatedReceiveAmount)} · cost {route.totalCostBps}{' '}
                  bps
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {search !== null && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Path search</h2>
          <p className="text-muted-foreground text-xs">
            Graph engine {search.graph.graphEngineVersion}. {search.matchingProviders.length} catalog
            providers support this pair. Never executable.
          </p>
          <ul className="space-y-1 font-mono text-xs">
            {search.graph.paths.map((path) => (
              <li key={path.pathId}>
                {path.assets.join(' → ')} · {path.totalCostBps} bps
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
