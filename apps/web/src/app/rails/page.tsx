import { RouteExplorer } from '@/components/route-explorer';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { fetchMeta } from '@/lib/api/client';

export default async function RailsPage() {
  const meta = await fetchMeta();

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? (meta.data.routingEngineVersion ?? meta.data.engineVersion) : null}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Multi-rail routing engine
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Score Traditional Finance, stablecoin and DeFi quotes with one framework. Cost, speed,
            liquidity, finality, FX rate, slippage and compliance are computed from quotes — never from a
            model.
          </p>
        </div>
        <RouteExplorer />
      </main>
      <SiteFooter notice="Indicative sandbox quotes. Meridian never holds funds, keys or wallets, and does not execute a swap, ramp or payout." />
    </>
  );
}
