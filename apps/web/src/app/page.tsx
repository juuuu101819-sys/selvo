import { RouteFinder } from '@/components/route-finder';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { ErrorState } from '@/components/states';
import { fetchMeta } from '@/lib/api/client';

/**
 * The whole product in one page: describe a transaction, get ranked routes.
 *
 * Platform metadata (supported currencies, registered rails, mode) is fetched on the server so the
 * form is built from what the API actually offers rather than a duplicated list that can drift.
 */
export default async function HomePage() {
  const meta = await fetchMeta();

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Rank payment routes for businesses and AI agents
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Meridian is a non-custodial comparison layer for businesses and AI agents. It compares
            traditional finance, stablecoin and wholesale liquidity routes, then reports all-in
            cost, fees, settlement time, slippage and a route score — without taking custody or
            moving funds. Quotes stay sandbox-labelled until a licensed partner is connected.
            Execution is not in this product. Meridian does not execute or delegate settlement.
          </p>
        </div>

        {meta.ok ? <RouteFinder meta={meta.data} /> : <ErrorState failure={meta.failure} />}
      </main>

      <SiteFooter
        notice="Meridian is non-custodial. It compares routes and never holds customer funds, private keys or wallets, never acts as principal, and does not execute or delegate settlement yet. Quotes are indicative and non-binding; transact directly with the provider you choose."
        extra={
          meta.ok && meta.data.pricing !== null ? (
            <p className="font-mono">
              pricing {meta.data.pricing.datasetVersion} · rates{' '}
              {meta.data.pricing.referenceRatesVersion} · {meta.data.providers.length} providers
            </p>
          ) : null
        }
      />
    </>
  );
}
