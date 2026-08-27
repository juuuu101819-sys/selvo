import { ShieldCheck } from 'lucide-react';
import { GraphExplorer } from '@/components/graph-explorer';
import { SiteHeader } from '@/components/site-header';
import { fetchMeta, fetchRouteGraph } from '@/lib/api/client';

export default async function GraphPage() {
  const [meta, graph] = await Promise.all([fetchMeta(), fetchRouteGraph()]);

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={
          meta.ok ? (meta.data.graphEngineVersion ?? meta.data.engineVersion) : null
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Financial route graph
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Assets and venues as a directed graph. Discover multi-hop conversions such as USD →
            USDC → USDT → KRW, then prune by hops, cost, liquidity, availability and compliance.
            Nothing here is a quote, a swap or a payout.
          </p>
        </div>
        <GraphExplorer graph={graph.ok ? graph.data : null} />
      </main>
      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-6xl px-4 py-6 text-xs sm:px-6">
          <p className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Graph metadata is indicative. Meridian never holds funds, keys or wallets, and does
              not submit a conversion, swap or payout.
            </span>
          </p>
        </div>
      </footer>
    </>
  );
}
