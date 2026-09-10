import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { StablecoinExplorer } from '@/components/stablecoin-explorer';
import { fetchMeta, fetchStablecoins } from '@/lib/api/client';

export default async function StablecoinsPage() {
  const [meta, catalog] = await Promise.all([fetchMeta(), fetchStablecoins()]);

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={
          meta.ok
            ? (meta.data.stablecoinRoutingEngineVersion ?? meta.data.engineVersion)
            : null
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Stablecoin routing
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Quote USDC and USDT against fiat and against each other. Meridian never holds the
            token, never connects to mainnet, and never creates a wallet. Routes are discovered,
            priced and compared here; execution stays with an external provider.
          </p>
        </div>
        <StablecoinExplorer catalog={catalog.ok ? catalog.data : null} />
      </main>
      <SiteFooter notice="Indicative sandbox quotes. Adding another stablecoin is a registry row plus adapter rates — the routing engine does not switch on ticker. No RPC, no keys, no custody." />
    </>
  );
}
