import { ShieldCheck } from 'lucide-react';
import { RouteFinder } from '@/components/route-finder';
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
            Find the best financial route for a business transaction
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Meridian compares traditional finance, stablecoin and wholesale liquidity routes, then
            reports the all-in cost, fees, settlement time, slippage and a route score for each.
            Quotes are indicative and sandbox-labelled until a licensed partner is connected.
            Meridian does not execute or delegate settlement.
          </p>
        </div>

        {meta.ok ? <RouteFinder meta={meta.data} /> : <ErrorState failure={meta.failure} />}
      </main>

      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-6xl space-y-2 px-4 py-6 text-xs sm:px-6">
          <p className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Meridian is non-custodial. It compares routes and never holds customer funds, private
              keys or wallets, never acts as principal, and does not execute or delegate settlement
              yet. Quotes are indicative and non-binding; transact directly with the provider you
              choose.
            </span>
          </p>
          {meta.ok && meta.data.pricing !== null && (
            <p className="font-mono">
              pricing {meta.data.pricing.datasetVersion} · rates{' '}
              {meta.data.pricing.referenceRatesVersion} · {meta.data.providers.length} providers
            </p>
          )}
        </div>
      </footer>
    </>
  );
}
