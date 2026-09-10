import { DefiExplorer } from '@/components/defi-explorer';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { fetchDefiLiquidity, fetchMeta } from '@/lib/api/client';

export default async function DefiPage() {
  const [meta, catalog] = await Promise.all([fetchMeta(), fetchDefiLiquidity()]);

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={
          meta.ok ? (meta.data.defiRoutingEngineVersion ?? meta.data.engineVersion) : null
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            DeFi liquidity routing
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Quote DEX, AMM and aggregator venues on demo USDC/USDT, ETH/USDC and ETH/USDT pools.
            When a stablecoin ramp or traditional FX desk can price the same pair, those quotes are
            ranked together. Meridian never submits a swap, never connects a wallet, and never
            holds a key.
          </p>
        </div>
        <DefiExplorer catalog={catalog.ok ? catalog.data : null} />
      </main>
      <SiteFooter notice="Indicative sandbox quotes. Adding Ethereum, Base, Arbitrum or Solana is a registry row plus an adapter — the routing engine does not switch on chain. No RPC, no keys, no custody, no submitted swap." />
    </>
  );
}
