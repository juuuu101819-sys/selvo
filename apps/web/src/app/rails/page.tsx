import { ShieldCheck } from 'lucide-react';
import { RouteExplorer } from '@/components/route-explorer';
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
      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-6xl px-4 py-6 text-xs sm:px-6">
          <p className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Indicative sandbox quotes. Meridian never holds funds, keys or wallets, and does not
              execute a swap, ramp or payout.
            </span>
          </p>
        </div>
      </footer>
    </>
  );
}
