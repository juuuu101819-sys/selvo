import { ShieldCheck } from 'lucide-react';
import { RoutingApiExplorer } from '@/components/routing-api-explorer';
import { SiteHeader } from '@/components/site-header';
import { fetchAssets, fetchCurrencies, fetchMeta } from '@/lib/api/client';
import { readSessionToken } from '@/lib/session';

export default async function DevelopersPage() {
  const [meta, assets, currencies, token] = await Promise.all([
    fetchMeta(),
    fetchAssets(),
    fetchCurrencies(),
    readSessionToken(),
  ]);

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Financial routing API
          </h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Versioned quote, path search and catalogs under <code>/api/v1</code>. Authenticate with
            a session or an organization API key. Keys are hashed, scoped, expirable and revocable.
            <code>transaction:create</code> records an execution intent — it never moves money.
          </p>
        </div>
        <RoutingApiExplorer
          assets={assets.ok ? assets.data.assets : []}
          currencies={currencies.ok ? currencies.data.currencies : []}
          signedIn={token !== null}
        />
      </main>
      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-6xl px-4 py-6 text-xs sm:px-6">
          <p className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Organization id is taken from the verified principal. API keys never store plaintext.
              Rate limits apply. Request logs redact secrets.
            </span>
          </p>
        </div>
      </footer>
    </>
  );
}
